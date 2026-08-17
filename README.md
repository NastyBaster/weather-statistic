# Forecast Reality Check

Навчальний застосунок, який показуватиме, наскільки прогноз погоди відповідає фактичним спостереженням. Перший етап містить адаптивний прототип із демонстраційними даними, інтерактивною таблицею та графіком.

## Локальний запуск

Потрібні Node.js 20+ і Python 3.

```bash
npm run dev
```

Відкрийте <http://localhost:4173>.

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

Поки секрети не налаштовано, CI працюватиме, але deployment очікувано завершуватиметься помилкою авторизації.
