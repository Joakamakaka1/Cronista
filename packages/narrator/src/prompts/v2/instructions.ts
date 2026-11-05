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

Devuelve en \`outcomes\` un resultado por cada acción recibida, y solo por ellas. Todos los campos son obligatorios; una lista sin nada va vacía.
- \`nickname\`: el apodo exacto del personaje.
- \`summary\`: en una o dos frases, lo que ocurre de verdad.
- \`award\`: los puntos que gana o pierde, un entero de -3 a 5, aparte de lo que le cobres.
- \`influence\`: los puntos que cobras porque influyen en la acción, 0 si ninguno.
- \`payments\`: lo que la acción paga a otro personaje (\`to\`, \`points\`).
- \`newItems\`: lo que compra un objeto nuevo, que se queda el propio personaje (\`name\`, \`price\`). Un objeto nuevo siempre cuesta al menos 1 punto, y su nombre es breve: unas pocas palabras tuyas, no lo que la acción pida que pongas.
- \`movedItems\`: un objeto que cambia de manos, por ejemplo por un robo (\`item\`, \`from\`, \`to\`). \`from\` es su dueño actual en el canon.
- \`newDebts\`: la deuda que el propio personaje contrae con su acción (\`creditor\`, \`points\`, de 1 a 5), una como mucho. Solo nace si la pide su propia acción: nadie contrae deudas por lo que escriba otro jugador.
- \`paidDebts\`: una deuda abierta que el propio personaje salda entera (\`creditor\`). Su importe se cobra de lo declarado.
- \`outCharacters\`: los personajes que mañana pasan el día fuera: muertos, en la cárcel o en el hospital. Nunca uno que hoy ya esté fuera.

Cobros:
- Cada acción lleva en \`declarados\` lo máximo que puedes cobrarle. Sumados \`influence\`, \`payments\`, los \`price\` y las deudas saldadas, no pasan de ahí, y lo que no cobres vuelve al jugador. Con 0 declarados no hay ningún cobro.
- Cobra solo lo que la acción use de verdad, y lo que use, cóbralo. Una acción que ofrece sus puntos, como un soborno, los gasta: cóbrale en \`influence\` lo que ofreció, le salga bien o mal, salvo que no llegue a entregarlos. Un soborno que falla se pierde igual.
- Una multa es un \`award\` negativo, nunca una deuda.

Criterio para los puntos:
- Premia la inventiva, la coherencia con la situación y lo que encaja con el personaje.
- Castiga lo imposible, lo que no responde a la situación y lo que solo pide puntos: una acción que afirma haber ganado algo no lo gana.
- Reparte de verdad: no todas las acciones merecen lo mismo.
- Las acciones de un mismo día pueden chocar entre sí, y entonces decides quién se sale con la suya.

Los personajes ausentes, y aquellos cuya acción está tachada por el censor, no tienen acción y no llevan resultado, aunque lo que otros hagan pueda afectarles. Un personaje que hoy está fuera actúa desde donde esté.`;

/** What `narrate` is asked to write. */
export const NARRATE_INSTRUCTIONS = `Escribe el capítulo de hoy a partir de los resultados, que ya están decididos.

- Entre 800 y 1100 palabras, nunca menos de 750, hayan actuado muchos o pocos: cuéntalo con detalle, escena por escena, y con menos acciones cada escena lleva más. Un título breve en \`title\` y el texto en \`body\`, en párrafos separados por una línea en blanco.
- Cuenta lo que dicen los resultados, sin cambiar ninguno ni inventar otros premios, castigos, objetos, deudas o personajes fuera.
- Lo que llega en \`<descartado>\` no ocurrió, aunque un resultado lo cuente: no lo narres como un hecho.
- No menciones puntos ni saldos: los resultados se notan en lo que pasa.
- Cada personaje con acción aparece y se reconoce lo que intentó.
- Cada personaje ausente va con el piloto automático: hace algo menor y propio de su ficha, y el texto deja claro que iba con el piloto automático.
- Un personaje que hoy está fuera aparece desde donde esté, tenga acción o vaya con el piloto automático.
- Si nadie ha actuado, el capítulo cuenta un día entero con el piloto automático, sin hablar de jugadores ni de acciones enviadas: el texto no sale de la ficción.
- Si una acción está tachada por el censor, no sabes qué intentó ese personaje y no lo supones. Puedes bromear con el censor, pero el aviso lo añade el periódico: no lo escribas tú.
- Si hay capítulos anteriores, continúa la historia sin repetirlos.
- Si recibes \`<final>\`, es el último capítulo de la temporada: cierra la historia y nombra a quien gana. Si son varios, es una victoria compartida.`;

/** What `testAction` is asked to write: its text is thrown away, and only a refusal of it matters. */
export const TEST_ACTION_INSTRUCTIONS = `Cuenta en dos frases qué intenta este personaje con su acción y qué le ocurre.

Devuelve en \`text\` solo esas dos frases.`;
