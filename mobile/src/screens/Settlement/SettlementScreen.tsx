/**
 * T064 — iOS settlement screen
 * Shows open settlement with per-member balances and mark-as-paid buttons.
 */
import { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native'
import { settlements } from '@expense-tracker/shared'
import type { Settlement } from '@expense-tracker/shared'
import { useAuthStore } from '../../stores/authStore'
import { useHouseholdStore } from '../../stores/householdStore'

function formatNok(ore: number) {
  return `kr ${(Math.abs(ore) / 100).toFixed(2).replace('.', ',')}`
}

export default function SettlementScreen() {
  const userId = useAuthStore((s: any) => s.userId)!
  const household = useHouseholdStore((s: any) => s.household)
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [loading, setLoading] = useState(true)
  const [markingId, setMarkingId] = useState<string | null>(null)

  useEffect(() => {
    if (!household) return
    settlements.list(household.id)
      .then((data: any) => {
        const open = data.settlements?.find((s: any) => s.status === 'open')
        if (open) return settlements.get(household.id, open.id)
        return null
      })
      .then((data) => {
        if (data) setSettlement(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [household?.id])

  async function markPaid(transactionId: string) {
    if (!settlement) return
    setMarkingId(transactionId)
    try {
      const result = await settlements.markPaid(settlement.id, transactionId)
      setSettlement((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === transactionId ? { ...t, paidAt: result.paidAt } : t
          ),
        }
      })
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to mark as paid.')
    } finally {
      setMarkingId(null)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#6366f1" />
      </View>
    )
  }

  if (!settlement) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No open settlement.</Text>
        <Text style={styles.emptyHint}>Ask your household admin to trigger one.</Text>
      </View>
    )
  }

  const periodLabel = settlement.periodYear && settlement.periodMonth
    ? new Date(settlement.periodYear, settlement.periodMonth - 1, 1)
        .toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })
    : '—'

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.period}>{periodLabel}</Text>

      {/* Balances */}
      <Text style={styles.sectionLabel}>Balances</Text>
      <View style={styles.card}>
        {settlement.balances.map((b, idx) => (
          <View key={b.userId} style={[styles.balanceRow, idx < settlement.balances.length - 1 && styles.borderBottom]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{b.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.balanceName}>{b.name}{b.userId === userId ? ' (you)' : ''}</Text>
            <Text style={[
              styles.balanceAmount,
              b.amountOre > 0 && styles.amountCredit,
              b.amountOre < 0 && styles.amountDebit,
            ]}>
              {b.amountOre >= 0 ? '+' : ''}{formatNok(b.amountOre)}
            </Text>
          </View>
        ))}
      </View>

      {/* Transactions */}
      <Text style={styles.sectionLabel}>Transactions</Text>
      {settlement.transactions.length === 0 ? (
        <Text style={styles.allEven}>All even — no transfers needed.</Text>
      ) : (
        settlement.transactions.map((tx) => (
          <View key={tx.id} style={[styles.txCard, !!tx.paidAt && styles.txCardPaid]}>
            <View style={styles.txInfo}>
              <Text style={styles.txNames}>
                <Text style={tx.fromUserId === userId ? styles.txYou : undefined}>{tx.fromUserId === userId ? 'You' : tx.fromName}</Text>
                {' → '}
                <Text style={tx.toUserId === userId ? styles.txYou : undefined}>{tx.toUserId === userId ? 'you' : tx.toName}</Text>
              </Text>
              <Text style={styles.txAmount}>{formatNok(tx.amountOre)}</Text>
            </View>
            {tx.paidAt ? (
              <Text style={styles.paidBadge}>✓ Paid</Text>
            ) : settlement.status === 'open' && (
              <TouchableOpacity
                style={styles.markPaidBtn}
                onPress={() => markPaid(tx.id)}
                disabled={markingId === tx.id}
              >
                {markingId === tx.id
                  ? <ActivityIndicator size="small" color="#818cf8" />
                  : <Text style={styles.markPaidText}>Mark paid</Text>
                }
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      {settlement.status === 'completed' && (
        <View style={styles.completedBanner}>
          <Text style={styles.completedText}>✓ This settlement is complete.</Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: '#a1a1aa', fontSize: 16, fontWeight: '500' },
  emptyHint: { color: '#52525b', fontSize: 14, textAlign: 'center' },
  period: { fontSize: 15, fontWeight: '500', color: '#a1a1aa', textTransform: 'capitalize', marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '500', color: '#71717a', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 4 },
  card: { backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', overflow: 'hidden' },
  borderBottom: { borderBottomWidth: 1, borderBottomColor: '#1f1f22' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
  balanceName: { flex: 1, color: '#f4f4f5', fontSize: 14 },
  balanceAmount: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, color: '#a1a1aa' },
  amountCredit: { color: '#4ade80' },
  amountDebit: { color: '#f87171' },
  txCard: { backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#27272a', padding: 14, gap: 10 },
  txCardPaid: { opacity: 0.5 },
  txInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txNames: { fontSize: 14, color: '#a1a1aa' },
  txYou: { color: '#f4f4f5', fontWeight: '600' },
  txAmount: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 15, color: '#f4f4f5', fontWeight: '500' },
  paidBadge: { fontSize: 13, color: '#4ade80', fontWeight: '500' },
  markPaidBtn: {
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(99,102,241,0.25)',
    padding: 10, alignItems: 'center',
  },
  markPaidText: { color: '#818cf8', fontSize: 14, fontWeight: '500' },
  allEven: { color: '#52525b', fontSize: 14, textAlign: 'center', padding: 20 },
  completedBanner: {
    backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a',
    padding: 14, alignItems: 'center',
  },
  completedText: { color: '#71717a', fontSize: 14 },
})

// Platform import for font
import { Platform } from 'react-native'
