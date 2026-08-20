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

## Структура стилів

`css/styles.css` є єдиною точкою підключення стилів і імпортує модулі в передбачуваному порядку:

- `variables.css` — дизайн-токени та глобальні CSS-змінні;
- `base.css` — базові стилі HTML-елементів;
- `layout.css` — спільний каркас сторінок;
- `components.css` — повторно використовувані компоненти;
- `pages/` — окремий файл для кожної сторінки;
- `responsive.css` — медіазапити й налаштування доступності руху.

## Перевірки

```bash
npm run check
```

## CI/CD

- `.github/workflows/ci.yml` перевіряє кожен Pull Request і зміни основних гілок.
- `.github/workflows/deploy.yml` створює Cloudflare Pages preview для Pull Request і production deployment після push у `main`.
- Для deployment у GitHub необхідно створити environments `development` і `production`, а також додати secrets `CLOUDFLARE_API_TOKEN` та `CLOUDFLARE_ACCOUNT_ID`.
- У Cloudflare Pages має існувати проєкт `forecast-reality-check`; production branch — `main`.
- GitHub environments `development` і `production` мають містити variables `SUPABASE_URL` та `SUPABASE_PUBLISHABLE_KEY` відповідних Supabase-проєктів.

Поки секрети не налаштовано, CI працюватиме, але deployment очікувано завершуватиметься помилкою авторизації.

## Supabase

Початкова міграція `supabase/migrations/202608170001_create_profiles_and_locations.sql` створює `profiles`, `locations`, індекси, RLS-політики та публічну RPC-перевірку `health_check`. Міграція `supabase/migrations/202608170002_create_profile_on_signup.sql` додає trigger, який автоматично створює `profiles` після реєстрації користувача.

Застосовуйте кожну нову міграцію спочатку до `weather-statistic-dev`, перевіряйте реєстрацію, RLS та PR preview, а після схвалення — до `weather-statistic-prod`. Не редагуйте вже застосовані міграції та не додавайте database password, secret key або `service_role` key у браузерну конфігурацію.
