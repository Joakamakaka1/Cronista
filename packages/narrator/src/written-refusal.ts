// Anchored to the start: the narrator's fiction can say "no puede" anywhere, and a model that declines
// opens with it. An apology before it is enough; without one, only verbs about the task itself count,
// because the narrator can tell a character "no voy a ayudarte" in its own voice.
const apologisingRefusal =
  /^\s*(lo siento|disculpa|perdona|i'?m sorry|sorry|i apologi[sz]e)[,.\s]+.{0,40}?\b(no puedo|no me es posible|no voy a|can'?t|cannot|won'?t|unable)\b/i;

const plainRefusal =
  /^\s*(no puedo|no me es posible) (ayudar|escribir|continuar|generar|crear|redactar|participar|narrar|cumplir|atender)|^\s*i (can'?t|cannot|won'?t|am unable to) (help|write|continue|generate|create|assist|comply|provide)/i;

/**
 * Whether a model's text declines to answer: a refusal that ends in `end_turn` and carries no stop
 * reason, so only its wording gives it away.
 */
export function isWrittenRefusal(text: string): boolean {
  return apologisingRefusal.test(text) || plainRefusal.test(text);
}
