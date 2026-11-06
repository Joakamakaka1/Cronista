import { MAX_ACTION_CHARACTERS } from '@cronista/core';

import { STAKE_WORD } from '../stake-word.ts';

const sessionUnavailable = 'No podemos comprobar tu sesión ahora mismo. Inténtalo en un momento.';

/** What a player reads when an action is not accepted, by the API's error code. */
export function actionErrorCopy(code: string): string {
  switch (code) {
    case 'no_character':
      return 'No tienes personaje en esta temporada, así que no puedes jugar.';
    case 'day_not_open':
      return 'El día todavía no está abierto: la situación sale a las 08:00.';
    case 'day_closed':
      return 'El día ya está cerrado: tu acción ha llegado después de las 22:00.';
    case 'action_already_sent':
      return 'Ya enviaste tu acción de hoy, y no se puede cambiar.';
    case 'stake_out_of_range':
      return `El ${STAKE_WORD.lower} tiene que ir de 0 a tu saldo, y sin ${STAKE_WORD.lower} si estás a cero o fuera.`;
    case 'invalid_body':
    case 'too_large':
      return `La acción tiene que tener entre 1 y ${String(MAX_ACTION_CHARACTERS)} caracteres.`;
    case 'auth_unavailable':
      return `${sessionUnavailable} Tu texto sigue aquí.`;
    case 'network':
      return 'No hay conexión. Tu texto sigue aquí: envíalo cuando vuelva.';
    default:
      return 'Algo ha fallado al enviar. Tu texto sigue aquí: inténtalo otra vez.';
  }
}

/** What a player reads when the hint does not arrive, by the API's error code. */
export function hintErrorCopy(code: string): string {
  switch (code) {
    case 'no_action':
      return 'Primero tienes que enviar tu acción.';
    case 'day_closed':
    case 'day_not_open':
      return 'El día ya está cerrado: hoy no hay pista.';
    case 'auth_unavailable':
      return sessionUnavailable;
    default:
      return 'La pista no ha llegado. No has gastado nada: pídela otra vez.';
  }
}
