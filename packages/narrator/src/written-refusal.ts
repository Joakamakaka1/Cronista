// Anchored to the start: the narrator's fiction can say "no puede" anywhere, and a model that declines
// opens with it.
const spanishRefusal =
  /^\s*((lo siento|disculpa|perdona)[,.\s]*)?(pero\s+)?(no puedo|no me es posible|no voy a|no estoy en condiciones de)\s+(ayudar|escribir|continuar|generar|crear|redactar|participar|narrar)/i;

const englishRefusal =
  /^\s*((i'?m sorry|sorry|i apologi[sz]e)[,.\s]*)?(but\s+)?i\s+(can'?t|cannot|won'?t|am unable to|am not able to)\s+(help|write|continue|generate|create|assist|comply|provide)/i;

/**
 * Whether a model's text declines to answer: a refusal that ends in `end_turn` and carries no stop
 * reason, so only its wording gives it away.
 */
export function isWrittenRefusal(text: string): boolean {
  return spanishRefusal.test(text) || englishRefusal.test(text);
}
