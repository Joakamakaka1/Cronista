import type { PushNotification } from './schemas/notification.ts';
import { CLOSING_MINUTE_OF_DAY, gameDayOf, gameMinuteOfDay } from './schedule.ts';

/**
 * What a push shows, which the service worker reads from the payload. Players see the title and the
 * body; the tap opens `url`, and a newer push with the same `tag` replaces the older one.
 */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
}

/**
 * The push for a notification that names nobody. Every text is in Spanish and in the newspaper's
 * voice, and none carries anything a player wrote or staked. Players see this text.
 */
export function pushMessage(
  notification: Exclude<PushNotification, { type: 'player-played' }>,
): PushMessage {
  switch (notification.type) {
    case 'day-opened':
      return {
        title: 'Edición de hoy',
        body: 'La situación del día ya está en portada. Tienes hasta las 22:00 para mover ficha.',
        url: '/',
        tag: `day-${notification.day}`,
      };
    case 'reminder': {
      const instant = new Date(notification.scheduledTime);
      const tag = `reminder-${gameDayOf(instant)}`;
      return gameMinuteOfDay(instant) >= CLOSING_MINUTE_OF_DAY - 60
        ? {
            title: 'Última llamada',
            body: 'Queda una hora. Si no mueves ficha, el piloto automático moverá a tu personaje, y eso cuesta 1.',
            url: '/',
            tag,
          }
        : {
            title: 'Quedan tres horas',
            body: 'La redacción aún espera tu acción. La edición cierra a las 22:00.',
            url: '/',
            tag,
          };
    }
    case 'chapter-published':
      return {
        title: 'Ya está en la calle',
        body: 'El capítulo de hoy acaba de salir de la imprenta.',
        url: `/capitulos/${notification.day}`,
        tag: `chapter-${notification.day}`,
      };
    case 'chapter-postponed':
      return {
        title: 'El periódico no sale esta noche',
        body: 'El capítulo sigue en la imprenta. Nadie gana ni pierde nada hasta que salga.',
        url: '/',
        tag: `chapter-${notification.day}`,
      };
  }
}

/** The push the other players get when `nickname` sends an action. Players see this text. */
export function playerPlayedMessage(day: string, nickname: string): PushMessage {
  return {
    title: `${nickname} ha movido ficha`,
    body: 'Ya ha enviado su acción de hoy. ¿Y tú?',
    url: '/',
    tag: `played-${day}-${nickname}`,
  };
}
