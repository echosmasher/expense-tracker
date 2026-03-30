/**
 * T063 — iOS receipt upload screen
 * Step 1: Camera/library picker → parse → navigate to ReviewScreen
 */
import { useState } from 'react'
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator,
  StyleSheet, Alert, Platform,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { receipts } from '@expense-tracker/shared'
import { useHouseholdStore } from '../../stores/householdStore'

export default function UploadScreen() {
  const router = useRouter()
  const household = useHouseholdStore((s: any) => s.household)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  async function pickImage(source: 'camera' | 'library') {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Camera permission', 'Camera access is needed to photograph receipts.')
        return
      }
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })

    if (result.canceled || !result.assets[0]) return

    const asset = result.assets[0]
    setPreview(asset.uri)
    setLoading(true)

    try {
      if (!household) throw new Error('No household found')

      // Convert URI to File-like object for the API client
      const filename = asset.uri.split('/').pop() ?? 'receipt.jpg'
      const mimeType = asset.mimeType ?? 'image/jpeg'
      const response = await fetch(asset.uri)
      const blob = await response.blob()
      const file = new File([blob], filename, { type: mimeType })

      const parsed = await receipts.parse(household.id, file)

      // Pass parsed data to review screen via params
      router.push({
        pathname: '/(app)/expenses/review',
        params: { parsed: JSON.stringify(parsed) },
      })
    } catch (err: any) {
      Alert.alert('Parse failed', err?.message ?? 'Could not read the receipt. Please try again.')
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      {preview ? (
        <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderIcon}>🧾</Text>
          <Text style={styles.placeholderText}>Photograph or select a receipt</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.loadingText}>Parsing receipt…</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => pickImage('camera')}>
            <Text style={styles.primaryBtnText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage('library')}>
            <Text style={styles.secondaryBtnText}>Choose from library</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b', padding: 20 },
  placeholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#3f3f46', borderStyle: 'dashed',
    borderRadius: 16, margin: 4,
  },
  placeholderIcon: { fontSize: 40, marginBottom: 12 },
  placeholderText: { color: '#71717a', fontSize: 15 },
  preview: { flex: 1, borderRadius: 12, marginBottom: 20 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  loadingText: { color: '#a1a1aa', fontSize: 15 },
  actions: { gap: 12 },
  primaryBtn: {
    backgroundColor: '#6366f1', borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#18181b', borderRadius: 12,
    borderWidth: 1, borderColor: '#27272a',
    padding: 16, alignItems: 'center',
  },
  secondaryBtnText: { color: '#a1a1aa', fontSize: 16, fontWeight: '500' },
})
