/**
 * The N1 golden set: an invented season of Villaescollo in moments, and the queries a later day would
 * ask with the moments each one should find. Everything is made up.
 */

/** A moment of the invented season, on its day from the season's start. */
export interface GoldenMoment {
  readonly key: string;
  readonly dayIndex: number;
  readonly text: string;
  readonly characters: readonly string[];
  readonly importance: number;
  readonly joke: string | null;
}

/** A query, as a day's situation or action, and the moments it should find. */
export interface GoldenQuery {
  readonly key: string;
  readonly text: string;
  readonly relevant: readonly string[];
}

const campana = 'la campana que da la hora cuando quiere';
const velas = 'las velas del banco central';
const pleno = 'el pleno sin quórum';
const inaugura = 'la alcaldesa inaugura lo que ya existe';
const duplicado = 'los documentos por duplicado';

const moment = (
  key: string,
  dayIndex: number,
  text: string,
  characters: readonly string[],
  importance: number,
  joke: string | null = null,
): GoldenMoment => ({ key, dayIndex, text, characters, importance, joke });

/** The season's moments, ten days of them. */
export const GOLDEN_MOMENTS: readonly GoldenMoment[] = [
  moment(
    'm01',
    0,
    'La Farera encontró en la playa una botella con un mapa del faro dibujado al revés.',
    ['La Farera'],
    4,
  ),
  moment(
    'm02',
    0,
    'El Notario certificó que la botella era un documento oficial por estar sellada con lacre.',
    ['El Notario'],
    3,
  ),
  moment(
    'm03',
    0,
    'La Alcaldesa inauguró la playa por tercera vez este año con un bando escrito sobre la arena.',
    ['La Alcaldesa'],
    2,
    inaugura,
  ),
  moment(
    'm04',
    0,
    'La campana dio las nueve a las nueve y veinte y el Sacristán culpó a la humedad.',
    ['El Sacristán'],
    2,
    campana,
  ),
  moment(
    'm05',
    0,
    'La Boticaria vendió a La Farera una infusión contra el mareo de faro.',
    ['La Boticaria', 'La Farera'],
    2,
  ),
  moment(
    'm06',
    1,
    'El Sacristán subió el precio de las velas un treinta por ciento alegando inflación litúrgica.',
    ['El Sacristán'],
    3,
    velas,
  ),
  moment(
    'm07',
    1,
    'La Farera y El Notario se pelearon en la plaza por la propiedad del mapa de la botella.',
    ['La Farera', 'El Notario'],
    5,
  ),
  moment(
    'm08',
    1,
    'La Gaceta del Escollo publicó que el mapa señalaba un tesoro bajo la fuente seca.',
    [],
    2,
  ),
  moment(
    'm09',
    1,
    'La Boticaria guardó en su registro el secreto de que El Notario no sabe nadar.',
    ['La Boticaria', 'El Notario'],
    4,
  ),
  moment(
    'm10',
    2,
    'La Alcaldesa ordenó excavar la fuente seca de la plaza en busca del tesoro.',
    ['La Alcaldesa'],
    4,
  ),
  moment(
    'm11',
    2,
    'Bajo la fuente seca solo apareció una llave oxidada con las iniciales del Sacristán.',
    ['El Sacristán'],
    5,
  ),
  moment(
    'm12',
    2,
    'El Sacristán negó que la llave oxidada fuera suya aunque llevaba sus iniciales grabadas.',
    ['El Sacristán'],
    3,
  ),
  moment(
    'm13',
    2,
    'El pleno votó la excavación de la fuente sin quórum, como siempre.',
    ['La Alcaldesa'],
    1,
    pleno,
  ),
  moment(
    'm14',
    3,
    'La Farera abrió con la llave oxidada la puerta del faro, cerrada desde hacía décadas.',
    ['La Farera'],
    5,
  ),
  moment(
    'm15',
    3,
    'Dentro del faro había cajas de velas del Sacristán escondidas, con el precio marcado.',
    ['La Farera', 'El Sacristán'],
    5,
  ),
  moment(
    'm16',
    3,
    'La Boticaria recetó al Notario jarabe de regaliz para la tos seca que usa como argumento.',
    ['La Boticaria', 'El Notario'],
    2,
  ),
  moment(
    'm17',
    3,
    'La campana dio las doce a las doce y veinte durante la apertura del faro.',
    ['El Sacristán'],
    1,
    campana,
  ),
  moment(
    'm18',
    4,
    'El Sacristán acusó a La Farera de allanar su almacén de velas en el faro.',
    ['El Sacristán', 'La Farera'],
    4,
  ),
  moment(
    'm19',
    4,
    'El Notario levantó acta de que el faro pertenece a quien tenga la llave.',
    ['El Notario'],
    4,
  ),
  moment(
    'm20',
    4,
    'La Alcaldesa declaró el faro patrimonio municipal para quedarse con las velas.',
    ['La Alcaldesa'],
    3,
  ),
  moment(
    'm21',
    4,
    'La Gaceta rectificó que bajo la fuente nunca hubo tesoro, solo una llave.',
    [],
    1,
  ),
  moment(
    'm22',
    5,
    'La Boticaria abrió una tienda de infusiones en la planta baja del faro.',
    ['La Boticaria'],
    3,
  ),
  moment(
    'm23',
    5,
    'La Farera prohibió entrar al faro a quien no traiga un barco avistado en su cuaderno.',
    ['La Farera'],
    3,
  ),
  moment(
    'm24',
    5,
    'El Notario intentó cruzar la ría a nado hasta el faro y lo rescató una barca.',
    ['El Notario'],
    4,
  ),
  moment(
    'm25',
    5,
    'El Sacristán bajó el precio de las velas a la mitad para vaciar el almacén incautado.',
    ['El Sacristán'],
    3,
    velas,
  ),
  moment(
    'm26',
    6,
    'La Alcaldesa perdió el bastón de mando en la ría durante el rescate del Notario.',
    ['La Alcaldesa', 'El Notario'],
    4,
  ),
  moment(
    'm27',
    6,
    'La Farera pescó el bastón de mando y se negó a devolverlo sin un bando a su favor.',
    ['La Farera', 'La Alcaldesa'],
    5,
  ),
  moment(
    'm28',
    6,
    'El pleno aprobó sin quórum un bando que nadie firmó.',
    ['La Alcaldesa'],
    1,
    pleno,
  ),
  moment(
    'm29',
    6,
    'La Boticaria cobró al Notario las mantas del rescate con un sello notarial.',
    ['La Boticaria', 'El Notario'],
    3,
  ),
  moment(
    'm30',
    7,
    'La Alcaldesa firmó un bando que nombraba a La Farera guardiana oficial del bastón.',
    ['La Alcaldesa', 'La Farera'],
    4,
  ),
  moment(
    'm31',
    7,
    'El Notario selló un documento que declara que él sí sabe nadar.',
    ['El Notario'],
    2,
  ),
  moment(
    'm32',
    7,
    'El Sacristán organizó una procesión de velas rebajadas hasta el faro.',
    ['El Sacristán'],
    2,
    velas,
  ),
  moment(
    'm33',
    7,
    'La campana tocó a procesión una hora tarde y nadie llegó a tiempo.',
    ['El Sacristán'],
    1,
    campana,
  ),
  moment(
    'm34',
    8,
    'Llegó al puerto nuevo un barco de verdad, el primero en años, cargado de sal.',
    [],
    3,
  ),
  moment(
    'm35',
    8,
    'La Farera anotó en su cuaderno el barco de sal como el único que ha visto de verdad.',
    ['La Farera'],
    4,
  ),
  moment(
    'm36',
    8,
    'La Boticaria compró toda la sal del barco para venderla como remedio contra la humedad.',
    ['La Boticaria'],
    3,
  ),
  moment(
    'm37',
    8,
    'El Notario certificó que el barco no existía hasta tener su registro por duplicado.',
    ['El Notario'],
    2,
    duplicado,
  ),
  moment(
    'm38',
    9,
    'La Alcaldesa inauguró el barco de sal con un champán que era una infusión de La Boticaria.',
    ['La Alcaldesa', 'La Boticaria'],
    3,
    inaugura,
  ),
  moment(
    'm39',
    9,
    'El capitán del barco de sal resultó ser primo lejano del Sacristán.',
    ['El Sacristán'],
    3,
  ),
  moment(
    'm40',
    9,
    'El Sacristán cobró al capitán el amarre del barco en velas.',
    ['El Sacristán'],
    2,
    velas,
  ),
  moment(
    'm41',
    9,
    'La Farera devolvió el bastón de mando a cambio de que el faro vuelva a tener luz.',
    ['La Farera', 'La Alcaldesa'],
    5,
  ),
  moment(
    'm42',
    9,
    'El Notario redactó por duplicado el acuerdo del bastón y cobró las dos copias.',
    ['El Notario'],
    2,
    duplicado,
  ),
];

/** What a later day asks, and what it should find. */
export const GOLDEN_QUERIES: readonly GoldenQuery[] = [
  {
    key: 'q01',
    text: 'La Farera vuelve a la playa a buscar otra botella con un mapa.',
    relevant: ['m01', 'm07'],
  },
  {
    key: 'q02',
    text: 'El Notario intenta demostrar que sabe nadar cruzando la ría.',
    relevant: ['m09', 'm24', 'm31'],
  },
  {
    key: 'q03',
    text: 'Investigo quién enterró la llave oxidada bajo la fuente.',
    relevant: ['m11', 'm12'],
  },
  {
    key: 'q04',
    text: 'La Alcaldesa convoca un pleno para votar algo importante.',
    relevant: ['m13', 'm28'],
  },
  {
    key: 'q05',
    text: 'El Sacristán vuelve a subir el precio de las velas.',
    relevant: ['m06', 'm25'],
  },
  { key: 'q06', text: 'La Boticaria vende sal como remedio en la plaza.', relevant: ['m36'] },
  { key: 'q07', text: 'Exijo saber de quién es el faro.', relevant: ['m19', 'm20'] },
  {
    key: 'q08',
    text: 'La Alcaldesa quiere recuperar el bastón de mando.',
    relevant: ['m26', 'm27', 'm41'],
  },
  {
    key: 'q09',
    text: 'La campana vuelve a ir con retraso en la fiesta.',
    relevant: ['m04', 'm17', 'm33'],
  },
  {
    key: 'q10',
    text: 'El capitán del barco pide ayuda a su familia en el pueblo.',
    relevant: ['m39'],
  },
  { key: 'q11', text: 'La Boticaria amplía su tienda de infusiones.', relevant: ['m22'] },
  {
    key: 'q12',
    text: 'La Farera revisa su cuaderno de barcos avistados.',
    relevant: ['m35', 'm23'],
  },
  {
    key: 'q13',
    text: 'La Gaceta publica otra noticia sobre el tesoro de la fuente.',
    relevant: ['m08', 'm21'],
  },
  { key: 'q14', text: 'Abro las cajas que había escondidas dentro del faro.', relevant: ['m15'] },
  { key: 'q15', text: 'El Notario exige que todo esté por duplicado.', relevant: ['m37', 'm42'] },
];
