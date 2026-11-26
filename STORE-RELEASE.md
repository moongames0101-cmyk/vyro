# VYRO 1.1.0: what's new and what you still need to do

## What's new in 1.1.0

- **VYRO+ (£1.99/month).** Crown badge, name colours and effects, premium fonts, profile themes, avatar borders, profile labels, premium reactions, stickers and message effects. You'll find it under **Settings → VYRO+** and **VYRO+** in the left menu.
- **VYRO Live.** People can go live with camera and microphone, with live chat and a report button. Only people aged **18 and over** can host. If an under-18 is found going live, a moderator bans them from going live permanently.
- **Moderation.** Admins get a **🛡️ Mod** tab in Settings. From there you can review reports, ban people from Live, and gift VYRO+.
- **Safety and privacy fixes.**
  - Other users can no longer see anyone's email address or birthday.
  - The login screen no longer lists accounts.
  - You can only message people who accepted your friend request.
  - Stories are now friends-only.
  - Password reset needs the recovery phrase.
  - Logins and sign-ups are rate limited.
  - Sign-up needs a real date of birth (13+) and a recovery phrase.
  - Under-18s are not suggested to adults.
  - People can't fake "system" messages.
  - Pictures must be uploaded, not linked from outside sites.
  - Nobody can change the update source through the website.
- **Sign-in page** now says: no ads, VYRO+ is £1.99, and Live is 18+.

Run `npm test` to check everything. All 19 checks should pass.

---

## 1. Make yourself an admin (5 minutes)

1. On Render, open your VYRO service and go to **Environment**.
2. Add `VYRO_ADMINS` and set it to your VYRO username. For more than one admin, separate the usernames with commas, e.g. `moon,jay`.
3. Save. Render restarts the server.
4. Log in. You'll see a **🛡️ Mod** tab in Settings.

## 2. Replace the Android signing key (before any store upload)

The old signing password (`vyroapp123`) was written in the code, and the code is public on GitHub. Make a new key before you publish anywhere.

1. Check whether the old key is on GitHub. If `android/vyro-release.keystore` is listed on your GitHub repo page, run:
   ```
   git rm --cached android/vyro-release.keystore
   git commit -m "Stop tracking the signing key"
   git push
   ```
   From now on `.gitignore` keeps keys out of GitHub.
2. Move the old `android/vyro-release.keystore` out of the project folder. Keep it somewhere safe in case you need it.
3. Pick a strong password. In the same Command Prompt window, run:
   ```
   set VYRO_KEYSTORE_PASS=your-new-strong-password
   npm run build:apk
   ```
   This makes a new key and signs the APK with it.
4. **Back up** the new `vyro-release.keystore` and its password. A USB stick and a password manager are good places. If you lose the key, you can't update the app on the Galaxy Store.

Note: people who installed the old APK have to uninstall it once before installing the new one, because the key changed.

## 3. Turn on VYRO+ card payments (web and desktop)

Stripe handles the payment pages, so card details never touch your server. Subscribers can cancel any time from a "Manage or cancel" button.

1. Create a Stripe account at stripe.com and finish the business details.
2. In Stripe, go to **Product catalogue → Add product**. Name it "VYRO+" and set the price to **£1.99, recurring, monthly**. Copy the **price ID** (it starts with `price_`).
3. Go to **Developers → API keys** and copy the **secret key** (it starts with `sk_`).
4. Go to **Developers → Webhooks → Add endpoint**.
   - URL: `https://YOUR-VYRO-SITE/api/plus/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the **signing secret** (it starts with `whsec_`).
5. Go to **Settings → Billing → Customer portal** and switch on **cancel subscriptions**.
6. On Render, add these settings:
   - `STRIPE_SECRET_KEY` = the `sk_` key
   - `STRIPE_PRICE_ID` = the `price_` ID
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_` secret
   - `VYRO_PUBLIC_URL` = your site address, e.g. `https://vyro-chat.onrender.com`
7. Test it with Stripe's **test mode** keys first. Use the test card `4242 4242 4242 4242`.

Never paste these keys into a chat, an email or GitHub. Only put them in Render's Environment page.

Card payments only appear on the website and the desktop app. Google Play and the Galaxy Store require their own billing for subscriptions inside the phone app. Until that billing is switched on, the phone app shows "Coming soon".

## 4. Galaxy Store (free)

1. Sign up at seller.samsungapps.com. It's free.
2. Upload the APK you built in step 2.
3. In the phone app, VYRO+ shows "Coming soon" until Samsung In-App Purchase is added. This needs native Android code, so it's a job for later (or for a developer). The server already has a spot ready for it and refuses Samsung purchases until then.

## 5. Google Play (one-off $25)

1. Make a Play Console account. Personal accounts must run a closed test with **12 testers for 14 days** before going public.
2. Create a subscription with the product ID `vyro_plus_monthly` at £1.99/month.
3. Create a Google Cloud **service account** with access to your Play Console. Paste its JSON key into Render as `VYRO_GOOGLE_SERVICE_ACCOUNT`.
4. Set up **Real-time developer notifications**.
   - Make a Pub/Sub push subscription that sends to `https://YOUR-VYRO-SITE/api/plus/google/rtdn?secret=SOMETHING-LONG-AND-RANDOM`.
   - Put the same random text in Render as `VYRO_RTDN_SECRET`.
5. Add the native piece. The app needs Google's Play Billing library added to the Android project. This is a developer step, because the current build script doesn't use Gradle.
   - The page already calls `window.VyroBilling.subscribe(productId, accountRef)`.
   - The native code must pass `accountRef` as the obfuscated account ID.
   - When the purchase finishes, the native code must call `window.onVyroPurchase(purchaseToken)`.
   - The server checks every purchase with Google before it gives VYRO+.

## 6. VYRO Live: good to know

- Video goes directly between phones and computers, so it costs you nothing to run. It works best with up to about 10 viewers per live.
- Some strict networks (school or work Wi-Fi, some mobile carriers) need a "TURN" relay server to connect.
- Bigger lives need a media service such as LiveKit or Cloudflare Calls.
- **Face age scan (new).** Before going live, the host does a 10-second scan on the Go Live screen.
  - They look at the camera, turn their head left and right, then look back.
  - It runs on their own phone or PC. Camera images are never uploaded or saved; only the estimated age number reaches the server.
  - **Start live** stays locked until the scan passes. A pass lasts 15 minutes. Everyone gets 6 scans a day.
  - The head turn stops a printed photo or a photo on a screen from passing. A video of someone else turning their head could still fool it.
  - To pass, the estimated age must be **18 or more**. The estimator can be a few years out, so some 16–17 year olds may pass. You can raise the pass mark on Render with `VYRO_FACE_MIN_AGE` (e.g. 21) to catch more of them, at the cost of blocking some real 18–20 year olds.
  - Faces estimated **under 18** are sent to the 🛡️ Mod tab, along with what the date of birth says. The scan never bans anyone by itself; a moderator decides.
  - During a live, the app quietly re-checks every few minutes. It flags the host to moderators if the face looks under 16, for example when someone younger takes over the phone. It never ends the live by itself.
  - To switch the scan off, set `VYRO_FACE_CHECK=off` on Render.
  - The age estimator is the open-source face-api model (MIT licence). It is a rough guide, not proof of age, and it tends to guess everyone closer to their late 20s. Under the UK Online Safety Act, a certified age-check service (for example Yoti) is the stronger option if Live grows.
  - Add a line to your privacy policy about the scan: it estimates age on the device, keeps only the number and the date, and never keeps the face image.
- Reports appear in the **🛡️ Mod** tab. **Ban from Live** is permanent and ends their live straight away. "Undo" only exists for mistakes: `POST /api/admin/live-unban`.

## 7. Releasing 1.1.0

1. `npm test`
2. `npm run build:exe` for the Windows app.
3. `set VYRO_KEYSTORE_PASS=...` then `npm run build:apk` for the Android app.
4. Push to GitHub and tag `v1.1.0`. The release workflow builds and publishes the Windows app, and desktop users get the update automatically.
