const messages = [
  [/invalid login credentials/i, "Неправильний email або пароль."],
  [/email rate limit exceeded/i, "Забагато листів надіслано за короткий час. Зачекайте й спробуйте пізніше."],
  [/user already registered/i, "Користувач із таким email уже зареєстрований."],
  [/password should be at least/i, "Пароль має містити щонайменше 8 символів."],
  [/(email not confirmed)/i, "Email ще не підтверджено. Перевірте Inbox і Spam."],
  [/(signup is disabled)/i, "Реєстрація тимчасово недоступна."],
  [/(weak password)/i, "Оберіть надійніший пароль щонайменше з 8 символів."],
  [/(load failed|failed to fetch|networkerror|network request failed|fetch failed|the internet connection appears to be offline)/i, "Не вдалося з’єднатися із сервером. Перевірте інтернет, вимкніть блокувальник або відкрийте сторінку у Safari чи Chrome замість Telegram WebView."],
];

export function isNetworkError(error) {
  return /(load failed|failed to fetch|networkerror|network request failed|fetch failed|offline)/i.test(error?.message ?? "");
}

export function authErrorMessage(error, fallback = "Не вдалося виконати запит. Спробуйте ще раз.") {
  const original = error?.message ?? "";
  return messages.find(([pattern]) => pattern.test(original))?.[1] ?? fallback;
}
