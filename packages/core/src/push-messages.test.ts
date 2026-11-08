import { describe, expect, it } from 'vitest';

import { playerPlayedMessage, pushMessage } from './push-messages.ts';

describe('pushMessage', () => {
  it('opens Today when the day opens', () => {
    expect(pushMessage({ type: 'day-opened', day: '2026-11-09' })).toEqual({
      title: 'Edición de hoy',
      body: 'La situación del día ya está en portada. Tienes hasta las 22:00 para mover ficha.',
      url: '/',
      tag: 'day-2026-11-09',
    });
  });

  it('sends the 19:00 reminder three hours before the close', () => {
    // 19:00 in Madrid is 18:00 UTC in November.
    const message = pushMessage({ type: 'reminder', scheduledTime: '2026-11-09T18:00:00Z' });
    expect(message.title).toBe('Quedan tres horas');
    expect(message.body).toBe('La redacción aún espera tu acción. La edición cierra a las 22:00.');
    expect(message.tag).toBe('reminder-2026-11-09');
  });

  it('sends the 21:00 reminder as the last call, naming the autopilot and its cost', () => {
    const message = pushMessage({ type: 'reminder', scheduledTime: '2026-11-09T20:00:00Z' });
    expect(message.title).toBe('Última llamada');
    expect(message.body).toBe(
      'Queda una hora. Si no mueves ficha, el piloto automático moverá a tu personaje, y eso cuesta 1.',
    );
    // The same tag: the last call replaces the earlier reminder on the phone.
    expect(message.tag).toBe('reminder-2026-11-09');
  });

  it('opens the chapter itself when it is published', () => {
    expect(pushMessage({ type: 'chapter-published', day: '2026-11-09' })).toEqual({
      title: 'Ya está en la calle',
      body: 'El capítulo de hoy acaba de salir de la imprenta.',
      url: '/capitulos/2026-11-09',
      tag: 'chapter-2026-11-09',
    });
  });

  it("speaks in the newspaper's voice when the chapter is postponed", () => {
    expect(pushMessage({ type: 'chapter-postponed', day: '2026-11-09' })).toEqual({
      title: 'El periódico no sale esta noche',
      body: 'El capítulo sigue en la imprenta. Nadie gana ni pierde nada hasta que salga.',
      url: '/',
      tag: 'chapter-2026-11-09',
    });
  });
});

describe('playerPlayedMessage', () => {
  it('names who played and nothing of what they did', () => {
    expect(playerPlayedMessage('2026-11-09', 'La Rata')).toEqual({
      title: 'La Rata ha movido ficha',
      body: 'Ya ha enviado su acción de hoy. ¿Y tú?',
      url: '/',
      tag: 'played-2026-11-09-La Rata',
    });
  });
});
