import { ZodError } from "zod";
const names: Record<string, string> = {
  answer: "Правильный ответ",
  text: "Текст вопроса",
  category: "Категория",
  explanation: "Пояснение",
  source: "Источник",
  media: "Медиа",
  min: "Минимум",
  max: "Максимум",
  value: "Стоимость",
  country: "Страна",
  name: "Имя",
  password: "Пароль",
  position: "Порядок",
  difficulty: "Сложность",
  anchorText: "Опорное событие",
  anchorDate: "Дата опорного события",
  targetDate: "Дата второго события",
  options: "Варианты ответа",
  camera: "Камера",
  heading: "Поворот камеры",
  pitch: "Наклон камеры",
  zoom: "Начальное приближение",
  minZoom: "Минимальное приближение",
  maxZoom: "Максимальное приближение",
  licenseUrl: "Ссылка на лицензию",
  panoramaFileId: "Файл панорамы",
  place: "Название места",
};
export function publicError(error: unknown): string {
  if (error instanceof ZodError)
    return error.issues
      .map((issue) => {
        const field = names[String(issue.path.at(-1))] ?? issue.path.join(".");
        const prefix = field ? field + ": " : "";
        if (issue.code === "custom") return prefix + issue.message;
        if (issue.code === "invalid_type")
          return prefix + "заполните поле значением нужного типа";
        if (issue.code === "too_small")
          return (
            prefix +
            (issue.type === "string"
              ? "введите не менее " + issue.minimum + " символов"
              : "значение должно быть не меньше " + issue.minimum)
          );
        if (issue.code === "too_big")
          return (
            prefix +
            (issue.type === "string"
              ? "не более " + issue.maximum + " символов"
              : "значение должно быть не больше " + issue.maximum)
          );
        if (
          issue.code === "invalid_enum_value" ||
          issue.code === "invalid_union_discriminator"
        )
          return prefix + "выберите допустимый вариант";
        return prefix + "проверьте формат значения";
      })
      .join("; ");
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|NetworkError|Load failed/i.test(message))
    return "Не удалось связаться с сервером. Проверьте подключение.";
  if (/timed out|timeout/i.test(message))
    return "Сервер не подтвердил действие вовремя. Проверьте состояние перед повторной попыткой.";
  if (/PrismaClient|Invalid.*invocation/i.test(message))
    return "Не удалось сохранить данные. Проверьте базу и повторите действие.";
  return message;
}
