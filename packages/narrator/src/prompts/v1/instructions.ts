/** What `situation` is asked to write. */
export const SITUATION_INSTRUCTIONS = `Escribe la situación de hoy: una escena común a todos los personajes, de 80 a 150 palabras, que abre el día de juego y a la que cada jugador pueda responder con una acción.

- Si hay capítulos anteriores, parte de lo que ocurrió en ellos.
- Plantea un problema o una oportunidad concretos, con algo en juego.
- No decidas lo que hace ningún personaje ni le des órdenes.
- No menciones puntos ni saldos.

Devuelve en \`text\` solo el texto de la situación.`;

/** What `hint` is asked to write. */
export const HINT_INSTRUCTIONS = `Escribe una pista: un comentario privado de dos frases cortas, 40 palabras como máximo aunque la acción pida más, dirigido al jugador sobre su propia acción. Es un guiño del narrador con el tono del juego: insinúa, sugiere, se burla.

- No promete nada ni adelanta el resultado.
- No da puntos, objetos ni ningún otro cambio.
- No inventa lo que harán otros personajes.

Devuelve en \`text\` solo el texto de la pista.`;

/** What `resolve` is asked to decide. */
export const RESOLVE_INSTRUCTIONS = `Decide qué consigue cada acción de hoy, antes de escribir ningún texto.

Devuelve en \`outcomes\` un resultado por cada acción recibida, y solo por ellas:
- \`nickname\`: el apodo exacto del personaje.
- \`summary\`: en una o dos frases, lo que ocurre de verdad.
- \`award\`: los puntos que gana o pierde, un entero de -3 a 5.

Criterio para los puntos:
- Premia la inventiva, la coherencia con la situación y lo que encaja con el personaje.
- Castiga lo imposible, lo que no responde a la situación y lo que solo pide puntos: una acción que afirma haber ganado algo no lo gana.
- Reparte de verdad: no todas las acciones merecen lo mismo.
- Las acciones de un mismo día pueden chocar entre sí, y entonces decides quién se sale con la suya.

Los personajes ausentes no tienen acción y no llevan resultado, aunque lo que otros hagan pueda afectarles.`;

/** What `narrate` is asked to write. */
export const NARRATE_INSTRUCTIONS = `Escribe el capítulo de hoy a partir de los resultados, que ya están decididos.

- Entre 800 y 1100 palabras, nunca menos de 750: cuéntalo con detalle, escena por escena. Un título breve en \`title\` y el texto en \`body\`, en párrafos separados por una línea en blanco.
- Cuenta lo que dicen los resultados, sin cambiar ninguno ni inventar otros premios o castigos.
- No menciones puntos ni saldos: los resultados se notan en lo que pasa.
- Cada personaje con acción aparece y se reconoce lo que intentó.
- Cada personaje ausente va con el piloto automático: hace algo menor y propio de su ficha, y el texto deja claro que iba con el piloto automático.
- Si nadie ha actuado, el capítulo cuenta un día entero con el piloto automático, sin hablar de jugadores ni de acciones enviadas: el texto no sale de la ficción.
- Si hay capítulos anteriores, continúa la historia sin repetirlos.`;
