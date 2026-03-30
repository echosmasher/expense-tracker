/**
 * Expo Router file-based navigation is configured via the `app/` directory.
 * This file exports the root Stack navigator for use with Expo Router's
 * `<Slot />` / `<Stack />` layout pattern.
 *
 * Screen structure mirrors the web app:
 *   (auth)/register, (auth)/login, (auth)/accept-invite
 *   (app)/home  → expense list
 *   (app)/expenses/[id]
 *   (app)/expenses/new
 *   (app)/settlement
 *   (app)/projects
 *   (app)/projects/[id]
 *   (app)/settings
 */

export { Stack } from 'expo-router'
