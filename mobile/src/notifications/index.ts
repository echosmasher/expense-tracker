/**
 * T065 — Expo push notification handler
 * - Registers APNs token on login
 * - Handles settlement.ready push notification (foreground + background tap)
 */
import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { auth } from '@expense-tracker/shared'

// Configure foreground notification behaviour
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/**
 * Register this device for push notifications and store the Expo push token
 * on the backend. Call this after successful login.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return // Push not available in simulator
  if (Platform.OS !== 'ios') return

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return

  const token = (await Notifications.getExpoPushTokenAsync()).data
  if (!token) return

  // Store token on backend (best-effort, non-blocking)
  try {
    await fetch('/api/v1/users/me/push-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
  } catch {
    // Non-fatal
  }
}

/**
 * React hook — subscribes to incoming notifications and notification taps.
 * Navigates to the settlement screen when user taps a settlement.ready notification.
 */
export function useNotificationHandler() {
  const router = useRouter()

  useEffect(() => {
    // Foreground notification received
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown>
      if (data?.type === 'settlement.ready' || data?.settlementId) {
        // Badge on settlement tab — navigation happens on tap
      }
    })

    // Notification tapped (foreground or background)
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>
      if (data?.settlementId || data?.type === 'settlement.ready') {
        router.push('/(app)/settlement')
      }
    })

    return () => {
      receivedSub.remove()
      responseSub.remove()
    }
  }, [router])
}
