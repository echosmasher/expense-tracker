/**
 * Root layout — Expo Router entry point.
 * Handles auth state and redirects to the correct initial screen.
 * Place this file as `app/_layout.tsx` in your Expo project.
 */
import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useAuthStore } from '../stores/authStore'

const AUTH_SEGMENTS = ['(auth)']

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    const inAuthGroup = segments[0] === '(auth)'
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(app)/home')
    }
  }, [isAuthenticated, segments])

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#f4f4f5',
          headerTitleStyle: { fontWeight: '600', fontSize: 17 },
          contentStyle: { backgroundColor: '#09090b' },
          headerShadowVisible: false,
        }}
      />
    </>
  )
}
