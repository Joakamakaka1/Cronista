import type { Narrator } from '@cronista/core';
import { outcomeOf, scriptedNarrator, usageOf } from '@cronista/engine/scripted';

/**
 * The harness's narrator: the engine's scripted one, with invented text long enough to judge how a
 * chapter reads. No model is called, so a local game day costs nothing.
 */
export function scriptedStory(): Narrator {
  return scriptedNarrator({
    situation: ({ day }) =>
      Promise.resolve({
        ok: true,
        value: {
          text: `Amanece el ${day} sobre el puerto con una niebla que no deja ver ni el faro. La grúa vieja, la que llevaba treinta años oxidándose junto al muelle, ha desaparecido durante la noche sin hacer ruido.\n\nEn la plaza ya circulan tres versiones distintas, y el alcalde ha convocado un pleno extraordinario para las doce. Nadie sabe quién tiene las llaves del almacén.`,
        },
        usage: [usageOf('situation')],
      }),
    hint: ({ action }) =>
      Promise.resolve({
        ok: true,
        value: {
          text: `${action.nickname}, quien pregunta en voz alta en este pueblo acaba contestando a más preguntas de las que hace.`,
        },
        usage: [usageOf('hint')],
      }),
    // Two points each, and a little of the stake spent on influence, so the ledger has charges.
    resolve: ({ actions }) =>
      Promise.resolve({
        ok: true,
        value: {
          outcomes: actions.map(({ nickname, stake }) =>
            outcomeOf(nickname, {
              summary: 'Lo consigue a medias.',
              award: 2,
              influence: Math.min(stake, 2),
            }),
          ),
        },
        usage: [usageOf('resolve')],
      }),
    narrate: ({ day, actions, absent }) =>
      Promise.resolve({
        ok: true,
        value: {
          title: 'La noche en que se perdió la grúa',
          body: [
            `El ${day} empezó con niebla y terminó con un pleno que nadie recordará por sus acuerdos. A las doce en punto el alcalde golpeó la mesa con la carpeta equivocada y anunció que la grúa no había desaparecido: simplemente nadie la estaba mirando.`,
            ...actions.map(
              ({ nickname }) =>
                `${nickname} se movió por el pueblo con la discreción de quien quiere que todos lo vean. Hubo puertas que se abrieron y otras que se cerraron con más fuerza de la necesaria, y al caer la tarde su nombre ya corría por la lonja.`,
            ),
            ...(absent.length === 0
              ? []
              : [
                  `Mientras tanto, ${absent.join(', ')} pasó el día como quien espera el autobús: sin prisa, sin plan y mirando al mar.`,
                ]),
            'Cuando el faro volvió a encenderse, la grúa seguía sin aparecer. Pero el almacén, por primera vez en años, tenía un candado nuevo.',
          ].join('\n\n'),
          pullQuote: 'Cuando el faro volvió a encenderse, la grúa seguía sin aparecer.',
        },
        usage: [usageOf('narrate')],
      }),
  }).narrator;
}
