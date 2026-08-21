# Forecast Reality Check

Навчальний застосунок, який показуватиме, наскільки прогноз погоди відповідає фактичним спостереженням. Перший етап містить адаптивний прототип із демонстраційними даними, інтерактивною таблицею та графіком.

## Локальний запуск

Потрібні Node.js 20+ і Python 3.

```bash
npm run dev
```

Відкрийте <http://localhost:4173>.

Без локальної Supabase-конфігурації protected dashboard перенаправляє на сторінку входу, де буде показано помилку конфігурації. Production і PR preview отримують `SUPABASE_URL` та `SUPABASE_PUBLISHABLE_KEY` із GitHub Environment variables під час `npm run build`.

## Авторизація

- `login.html` підтримує Google OAuth, реєстрацію та вхід через email/password, а також надсилання листа для відновлення пароля.
- `reset-password.html` приймає recovery session із Supabase та дозволяє встановити новий пароль.
- `index.html` залишається публічним із демонстраційними даними; авторизований користувач бачить email і кнопку виходу, а гість — кнопку входу.
- Сторінки авторизації показують помітку `development`, `production` або `local`, щоб тестовий preview не плутали з основним сайтом.
- Для локальної перевірки згенеруйте `runtime-config.js` через `SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... npm run build`, а потім обслуговуйте каталог `dist` статичним сервером.

У Supabase Authentication → URL Configuration додайте локальний URL `http://localhost:4173/reset-password.html`, URL PR preview та production URL до Redirect URLs. Не використовуйте wildcard production-домену ширший, ніж потрібно.

Для Google OAuth створіть окремі Web application clients для development і production. У Google Authorized redirect URIs додайте callback відповідного Supabase-проєкту у форматі `https://<project-ref>.supabase.co/auth/v1/callback`, а Client ID і Client Secret зберігайте лише в налаштуваннях Google provider у Supabase. До Supabase Redirect URLs додайте `http://localhost:4173/index.html`, точні адреси PR preview та production. Google Client Secret не належить до browser-конфігурації або GitHub variables застосунку.

Для development-проєкту можна дозволити лише preview-піддомени цього Cloudflare Pages проєкту шаблоном `https://*.forecast-reality-check.pages.dev/**`; окремо додайте `https://forecast-reality-check.pages.dev/**`, якщо OAuth перевіряється на кореневому домені. Не використовуйте ширший шаблон для всіх `pages.dev`. `Site URL` не повинен посилатися на тимчасовий або закритий PR: якщо переданий застосунком `redirectTo` відсутній у Redirect URLs, Supabase використає `Site URL` як fallback і користувач опиниться на іншому deployment. Після зміни URL Configuration повторний build не потрібен.

## Структура стилів

`css/styles.css` є єдиною точкою підключення стилів і імпортує модулі в передбачуваному порядку:

- `variables.css` — дизайн-токени та глобальні CSS-змінні;
- `base.css` — базові стилі HTML-елементів;
- `layout.css` — спільний каркас сторінок;
- `components.css` — повторно використовувані компоненти;
- `pages/` — окремий файл для кожної сторінки;
- `responsive.css` — медіазапити й налаштування доступності руху.

## Персональні міста

Dashboard залишається публічним: гість бачить демонстраційні дані для Києва й Львова, пояснення та посилання на вхід, але застосунок не звертається до `locations`. Після входу через email/password або Google той самий auth subscription запускає завантаження лише власних записів користувача. Вихід одразу очищує персональний список, а вхід іншим обліковим записом завантажує його дані.

Місто можна додати, активувати, призупинити або видалити після підтвердження. Координати та IANA timezone беруться з невеликого локального каталогу українських міст у `js/city-catalog.js`; зовнішнє геокодування свідомо відкладене. Серверний unique constraint остаточно захищає від дублікатів.

### Ручна перевірка RLS двома користувачами

1. Увійдіть як User A та додайте Київ.
2. В окремому browser profile увійдіть як User B та додайте Львів.
3. Переконайтеся, що A бачить лише Київ, а B — лише Львів.
4. Через Supabase client із сесією A спробуйте update/delete UUID запису B: операція не повинна змінити рядок.
5. Без сесії виконайте select із `locations`: anonymous client не повинен отримати записи.

RLS є серверною межею безпеки; frontend додатково фільтрує запити за authenticated user ID, отриманим через Supabase Auth. `user_id` не приймається з форми. `service_role` ніколи не використовується у frontend. Усі майбутні зміни schema мають додаватися новими migrations, які спочатку перевіряються у development; застосовані migrations не редагуються.

## Перевірки

```bash
npm run check
```

## CI/CD

- `.github/workflows/ci.yml` перевіряє кожен Pull Request і зміни основних гілок.
- `.github/workflows/deploy.yml` створює Cloudflare Pages preview для Pull Request і production deployment після push у `main`.
- Для перевірки auth UX відкрийте URL з кроку `Deploy to Cloudflare Pages` у PR: workflow публікує окремий preview для гілки та додає адресу до summary запуску.
- Для deployment у GitHub необхідно створити environments `development` і `production`, а також додати secrets `CLOUDFLARE_API_TOKEN` та `CLOUDFLARE_ACCOUNT_ID`.
- У Cloudflare Pages має існувати проєкт `forecast-reality-check`; production branch — `main`.
- GitHub environments `development` і `production` мають містити variables `SUPABASE_URL` та `SUPABASE_PUBLISHABLE_KEY` відповідних Supabase-проєктів.

Поки секрети не налаштовано, CI працюватиме, але deployment очікувано завершуватиметься помилкою авторизації.

## Supabase

Початкова міграція `supabase/migrations/202608170001_create_profiles_and_locations.sql` створює `profiles`, `locations`, індекси, RLS-політики та публічну RPC-перевірку `health_check`. Міграція `supabase/migrations/202608170002_create_profile_on_signup.sql` додає trigger, який автоматично створює `profiles` після реєстрації користувача.

Застосовуйте кожну нову міграцію спочатку до `weather-statistic-dev`, перевіряйте реєстрацію, RLS та PR preview, а після схвалення — до `weather-statistic-prod`. Не редагуйте вже застосовані міграції та не додавайте database password, secret key або `service_role` key у браузерну конфігурацію.

## Forecast Reality Check 5.0

Етап 5.0 фіксує контракт даних до реалізації collector. Нова міграція додає operational runs та незмінні daily snapshots із local-date horizon, idempotency key, constraints, indexes і read-only ownership RLS. Open-Meteo обрано на підставі офіційної документації, але frontend іще не виконує weather API requests.

- Повне рішення щодо provider, canonical units, timezone/date semantics, retry, partial failure, ownership, каскадного видалення та service-role boundary: [`docs/architecture/forecast-data-contract.md`](docs/architecture/forecast-data-contract.md).
- Точний план застосування лише до development і двокористувацької runtime-перевірки RLS/immutability/cascade: [`docs/validation/forecast-schema-development.md`](docs/validation/forecast-schema-development.md).

Production migration дозволена лише після успішної development validation та review. Edge Function, adapter, manual trigger, scheduler, observations, accuracy calculations і real-data dashboard відкладені до наступних етапів.
