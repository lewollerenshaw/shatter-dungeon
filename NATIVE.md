# Native apps (iOS and Android)

The game is wrapped with [Capacitor](https://capacitorjs.com): the same web build runs inside a native shell, and purchases and ads go through native SDKs.

| Piece | What is used | Where |
|---|---|---|
| Shell | Capacitor 8 | `capacitor.config.json`, `ios/`, `android/` |
| Purchases | RevenueCat (`@revenuecat/purchases-capacitor`) | `src/platform/gateways.ts` |
| Rewarded ads | AdMob (`@capacitor-community/admob`) | `src/platform/gateways.ts` |
| Save backup | `@capacitor/preferences` | `src/storage.ts` |

The game code only knows the `Platform` interface (`src/platform/platform.ts`). `src/platform/index.ts` picks the simulated platform in a browser and `NativePlatform` in the app.

## Commands

```bash
npm run cap:sync   # build the web app and copy it into both native projects
npm run ios        # the same, then open Xcode
npm run android    # the same, then open Android Studio
```

Run `npm run cap:sync` after every change to the game or to `.env.local`, then build from Xcode or Android Studio.

## State of things

- **iOS** builds and runs in the simulator on this Mac (iPhone 15 Pro, iOS 17.2). Checked there: the layout below the Dynamic Island, touch aiming, the save surviving a relaunch, and a rewarded test ad paying out a chest. It has not been run on a real iPhone.
- **Android** is generated and configured but has never been built: this Mac has no Android SDK and its Java is too old. Install Android Studio (which brings both) before `npm run android`.
- **Purchases are off** until RevenueCat keys are set. The store screen shows "Unavailable" instead of prices.
- **Ads use Google's sample ids**, which only serve test ads. They work without an AdMob account.
- **App id** is the placeholder `com.shatterdungeon.app`.
- **Icons and splash screens** are Capacitor's defaults.

To try every flow on a device before the accounts exist, put `VITE_SIMULATE_STORE=1` in `.env.local` and sync. That uses the pretend store and ads inside the app. Never ship a build with it set: it gives gems away.

## Configuration

Copy `.env.example` to `.env.local` and fill it in. Vite bakes these into the web build.

| Variable | What it is |
|---|---|
| `VITE_API_URL` | Address of the leaderboard server. The app has no dev proxy, so without this the Weekly Tower shows as unreachable. |
| `VITE_RC_IOS_KEY`, `VITE_RC_ANDROID_KEY` | RevenueCat public SDK keys, one per store. |
| `VITE_ADMOB_REWARDED_IOS`, `VITE_ADMOB_REWARDED_ANDROID` | Your rewarded ad unit ids. Empty means Google's test units. |
| `VITE_SIMULATE_STORE` | `1` forces the pretend store and ads in the app. Testing only. |

Two ids live in the native projects, not in `.env.local`, because the ad SDK reads them before the web view starts:

- iOS AdMob app id: `GADApplicationIdentifier` in `ios/App/App/Info.plist`
- Android AdMob app id: the `com.google.android.gms.ads.APPLICATION_ID` entry in `android/app/src/main/AndroidManifest.xml`

Both are set to Google's sample app ids.

## What you need to do before release

These need your accounts, your payment details or your legal decisions, so they are not done.

### 1. App identity

- Choose the real app id and replace `com.shatterdungeon.app` in `capacitor.config.json`, in the Xcode project (target App, Signing & Capabilities, Bundle Identifier), and in `android/app/build.gradle` (`applicationId` and `namespace`). It cannot change after the first store upload.
- Replace the icons and splash screens. `npx @capacitor/assets generate` builds every size from one source image.

### 2. Store accounts and products

- Join the Apple Developer Program and create the app in App Store Connect. Sign the Paid Apps agreement and enter tax and banking details, or products will not load.
- Create a Google Play Console account and the app there.
- In each store create these five in-app products as **consumables**, with exactly these ids (they are defined in `PRODUCTS` in `src/sim/store.ts`):

  | Product id | What the game grants |
  |---|---|
  | `starter_pack` | 400 gems, 3,000 coins, a Golden Chest (the game allows it once) |
  | `gems_small` | 100 gems |
  | `gems_medium` | 550 gems |
  | `gems_large` | 1,200 gems |
  | `battle_pass` | Premium pass for the current season |

  The prices players see come from the stores, not from the game.

### 3. RevenueCat

- Create a RevenueCat project, add the iOS and the Android app, and connect each to its store.
- Add the five products.
- Put the two public SDK keys in `.env.local`.

### 4. AdMob

- Create an AdMob account, register both apps, and create one rewarded ad unit for each.
- Put the two app ids in `Info.plist` and `AndroidManifest.xml` (see above) and the two unit ids in `.env.local`.
- Replace the single `SKAdNetworkItems` entry in `Info.plist` with Google's current full list.
- Set up a consent message under Privacy & messaging in AdMob. The app already asks for consent and for tracking permission the first time a player chooses to watch an ad, but the consent form only appears once that message exists.

### 5. Leaderboard server

- Host `server/` somewhere and set `VITE_API_URL`. It has only ever run on this Mac.

### 6. Store listing and compliance

- A privacy policy, Apple's privacy labels and Google's data safety form. The ad and purchase SDKs collect device identifiers and purchase history.
- An age rating. The chests are paid random items: the game shows their odds in the store, but some countries restrict or ban them, so check where you plan to sell.
- Apple's export compliance question about encryption.

## Known limits

- **Progress lives on the device.** There are no accounts and no cloud save. Deleting the app deletes the save, including bought gems, and consumable purchases cannot be restored.
- **The save can be edited** on a jailbroken or rooted device. RevenueCat confirms that a purchase is real before the game grants it, but nothing stops someone changing their own gem count afterwards. The Weekly Tower is unaffected because it ignores the player's profile.
- **Refunds are not clawed back.** A refunded purchase keeps its gems.
- **Real purchases have never run.** `NativePlatform` is tested against fake SDKs, and the RevenueCat binding in `gateways.ts` follows the plugin's published types, but nothing has been bought, not even in a store sandbox. The AdMob binding has only shown Google's test ads.
