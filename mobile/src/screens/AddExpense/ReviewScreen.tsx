/**
 * T063 — iOS receipt review screen
 * Step 2: Review parsed line items, toggle personal, confirm expense
 */
import { useState } from 'react'
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  Switch, StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { expenses } from '@expense-tracker/shared'
import type { ParsedReceipt } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'

interface EditableItem {
  description: string
  quantity: number
  unitPriceOre: number
  isPersonal: boolean
  confidenceLow: boolean
}

function formatNok(ore: number) {
  return `kr ${(ore / 100).toFixed(2).replace('.', ',')}`
}

export default function ReviewScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ parsed: string }>()
  const userId = useAuthStore((s: any) => s.userId)!
  const household = useHouseholdStore((s: any) => s.household)!

  const parsed: ParsedReceipt = params.parsed ? JSON.parse(params.parsed) : { items: [], receiptImageKey: '' }

  const [items, setItems] = useState<EditableItem[]>(
    parsed.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceOre: item.unitPriceOre,
      isPersonal: false,
      confidenceLow: item.confidenceLow,
    }))
  )
  const [saving, setSaving] = useState(false)

  function updateItem(idx: number, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)))
  }

  const total = items.reduce((sum, item) => sum + item.unitPriceOre * item.quantity, 0)

  async function handleConfirm() {
    if (items.length === 0) {
      Alert.alert('No items', 'Add at least one line item.')
      return
    }
    setSaving(true)
    try {
      const expense = await expenses.create(household.id, {
        receiptImageKey: parsed.receiptImageKey,
        store: parsed.store ?? undefined,
        date: parsed.date ?? undefined,
        purchasedBy: userId,
        cardLastFour: parsed.detectedCardLastFour ?? undefined,
        lineItems: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPriceOre: item.unitPriceOre,
          isPersonal: item.isPersonal,
        })),
      })
      const confirmed = await expenses.confirm(household.id, expense.id)
      router.replace(`/(app)/expenses/${confirmed.id}`)
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.metaRow}>
        <Text style={styles.storeName}>{parsed.store ?? 'Unknown store'}</Text>
        <Text style={styles.totalAmount}>{formatNok(total)}</Text>
      </View>

      <Text style={styles.sectionLabel}>Line items</Text>

      {items.map((item, idx) => (
        <View key={idx} style={[styles.itemCard, item.confidenceLow && styles.itemCardLowConf]}>
          <TextInput
            style={styles.itemDesc}
            value={item.description}
            onChangeText={(v) => updateItem(idx, { description: v })}
            placeholder="Description"
            placeholderTextColor="#52525b"
          />
          <View style={styles.itemNumbers}>
            <TextInput
              style={styles.itemNumInput}
              value={String(item.quantity)}
              onChangeText={(v) => updateItem(idx, { quantity: parseFloat(v) || 1 })}
              keyboardType="decimal-pad"
            />
            <Text style={styles.itemSep}>×</Text>
            <TextInput
              style={[styles.itemNumInput, styles.itemPriceInput]}
              value={String(item.unitPriceOre)}
              onChangeText={(v) => updateItem(idx, { unitPriceOre: Math.round(parseFloat(v) || 0) })}
              keyboardType="decimal-pad"
            />
            <Text style={styles.itemOreLabel}>øre</Text>
          </View>
          <View style={styles.itemRow}>
            <Text style={styles.personalLabel}>Personal</Text>
            <Switch
              value={item.isPersonal}
              onValueChange={(v) => updateItem(idx, { isPersonal: v })}
              trackColor={{ false: '#27272a', true: '#6366f1' }}
              thumbColor="#f4f4f5"
            />
          </View>
          {item.confidenceLow && (
            <Text style={styles.confWarn}>⚠ Low confidence — please verify</Text>
          )}
        </View>
      ))}

      <TouchableOpacity
        style={styles.confirmBtn}
        onPress={handleConfirm}
        disabled={saving}
      >
        {saving
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.confirmBtnText}>Confirm · {formatNok(total)}</Text>
        }
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 20, gap: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  storeName: { fontSize: 18, fontWeight: '600', color: '#f4f4f5' },
  totalAmount: { fontSize: 18, fontWeight: '500', color: '#f4f4f5', fontVariant: ['tabular-nums'] },
  sectionLabel: { fontSize: 11, fontWeight: '500', color: '#71717a', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 },
  itemCard: { backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', padding: 14, gap: 10 },
  itemCardLowConf: { borderColor: '#92400e' },
  itemDesc: { fontSize: 15, color: '#f4f4f5' },
  itemNumbers: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemNumInput: { backgroundColor: '#09090b', borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, color: '#a1a1aa', padding: 6, width: 52, textAlign: 'center', fontSize: 14 },
  itemPriceInput: { width: 76, textAlign: 'right' },
  itemSep: { color: '#52525b', fontSize: 14 },
  itemOreLabel: { color: '#52525b', fontSize: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  personalLabel: { fontSize: 14, color: '#71717a' },
  confWarn: { fontSize: 12, color: '#f59e0b' },
  confirmBtn: { backgroundColor: '#6366f1', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 8 },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
