# Remindely setup

## 1. Fill in the keys (top of `index.html`)
Search for `CONFIGURATION` and replace the four placeholders:

| Constant | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | same page, `anon` / publishable key (never the service_role key) |
| `APP_EMAIL` | any email you choose, for example `owner@remindely.app` (see step 3) |
| `GROQ_API_KEY` | console.groq.com (used for reading timetable, date sheet and Classroom screenshots) |

`VAPID_PUBLIC` is already filled in.

Note: a Groq key written into a web page can be read by anyone who can open that page. Keep the app URL private, or set a spending limit on the key.

## 2. Database
Supabase > SQL Editor > paste `setup.sql`. Before running the last block, replace
`YOUR_PROJECT_REF` and `YOUR_CRON_SECRET` (make up any long random secret).

## 3. Your single password
Supabase > Authentication > Users > Add user:
- Email: the same value as `APP_EMAIL`
- Password: the password you want to type on each new device (6+ characters)
- Tick Auto Confirm User

Then Authentication > Sign In / Providers > turn off "Allow new users to sign up".

On a new device the app asks for this password once, then stays signed in until you press Sign out in Settings.

## 4. Push notifications (server)
Supabase > Edge Functions > create `send-reminders`, paste `supabase/functions/send-reminders/index.ts`, and turn **Verify JWT off**.
Edge Functions > Secrets, add:

| Name | Value |
|---|---|
| `VAPID_PUBLIC` | `BC6gWW8WV45IYSyNengf_lNmX_YvQAxfzuUP-Tq1gTHEj2XSuI9aiP9oO8k5eYsC_tsLVTUukZf8LegFE_UF7cg` |
| `VAPID_PRIVATE` | `h13vo2pfQUlcy7GIZ8pxSzBK2_ELspcmMBUCE2JkxEU` |
| `VAPID_SUBJECT` | `mailto:you@example.com` |
| `CRON_SECRET` | the same secret you used in `setup.sql` |

The function uses UTC+05:00 (Pakistan). To change it, edit `TZ_OFFSET_MIN` in the function.

## 5. Host the files
Upload the whole folder (`index.html`, `sw.js`, `manifest.webmanifest`, `icons/`) to any HTTPS static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). Service workers, install and push do not work from a local file.

## 6. On each device
1. Open the site and enter your password.
2. Settings > Install app (iPhone: Share > Add to Home Screen, then open it from the Home Screen).
3. Settings > Enable push notifications > Allow.
4. Press "Test alert and sound" to check.
