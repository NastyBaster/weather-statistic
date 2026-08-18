const messages = [
  [/invalid login credentials/i, "Неправильний email або пароль."],
  [/email rate limit exceeded/i, "Забагато листів надіслано за короткий час. Зачекайте й спробуйте пізніше."],
  [/user already registered/i, "Користувач із таким email уже зареєстрований."],
  [/password should be at least/i, "Пароль має містити щонайменше 8 символів."],
  [/(load failed|failed to fetch|networkerror)/i, "Не вдалося з’єднатися із сервером. Перевірте інтернет і спробуйте ще раз."],
];

export function authErrorMessage(error, fallback = "Не вдалося виконати запит. Спробуйте ще раз.") {
  const original = error?.message ?? "";
  return messages.find(([pattern]) => pattern.test(original))?.[1] ?? fallback;
}
