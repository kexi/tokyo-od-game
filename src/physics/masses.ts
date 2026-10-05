/**
 * Masses of everything that moves in the game, from published figures (sources in
 * knowledge/vehicle-mass-and-collisions.md, which carries the same table). Vehicle masses are the
 * 車両重量 (curb weight, fuel and fluids included, nobody aboard) of the class the model stands for;
 * people and load are added on top by whoever is aboard. Values marked "assumed" have no source.
 */

/** Every class the game knows. Kei car, minivan, ambulance and bicycle have no physics body yet. */
export type MassClass =
  | "playerCar"
  | "jpnTaxi"
  | "patrol"
  | "unmarked"
  | "shirobai"
  | "ambulance"
  | "sedan"
  | "kei"
  | "minivan"
  | "bus"
  | "truck10t"
  | "truck8t"
  | "motorbike"
  | "bicycle";

export type VehicleSpec = {
  /** 車両重量 (kg). */
  curbKg: number;
  /** Power at the wheels' source (kW): 最高出力, or the hybrid system's estimate (see powerNote). */
  powerKw: number;
  /** Full-brake deceleration on dry asphalt (m/s²), assumed per class (see BRAKE_*). */
  brake: number;
  /** Launch limit (in g): the grip of the driven wheels, assumed per class. */
  launchG: number;
  /** Drag area Cd·A (m²) for the air resistance at speed, assumed per class. */
  cdA: number;
  /** 最大積載量 (kg), for the load a truck carries. */
  payloadKg?: number;
  /** 乗車定員, for the people a bus carries. */
  seats?: number;
  /** Where the figures come from (short; the doc has the links). */
  source: string;
};

// A hybrid's system output is not on Toyota's spec sheets (engine and motor are listed apart). The
// one system figure found for the same 2ZR-FXE drive (Noah R80: engine 73 kW, motor 60 kW, system
// 100 kW) gives 0.75 of the sum, used for the other hybrids. Why not the engine alone: the motor
// does most of the launching in these cars.
const HYBRID_SHARE = 100 / (73 + 60);
const hybrid = (engineKw: number, motorKw: number) => Math.round((engineKw + motorKw) * HYBRID_SHARE);

// Full-brake decelerations (assumed): about 0.8 g for cars on dry asphalt with ABS, 0.7 g for a
// motorcycle (both wheels, ABS), 0.55 g for buses and trucks on air brakes. The type-approval
// minima they must beat (UN R13-H / R13 / R78, 細目告示 第15条) are lower.
const BRAKE_CAR = 8;
const BRAKE_BIKE = 7;
const BRAKE_HEAVY = 5.4;

export const VEHICLE_SPECS: Record<MassClass, VehicleSpec> = {
  playerCar: {
    curbKg: 1390,
    powerKw: hybrid(72, 70),
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.65,
    source:
      "トヨタ カローラ スポーツ G“Z” 主要諸元表 2026-07（車両重量 1,390 kg、エンジン 72 kW・モーター 70 kW）",
  },
  jpnTaxi: {
    curbKg: 1420,
    powerKw: hybrid(54, 45),
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.85,
    seats: 5,
    source: "トヨタ JPN TAXI 匠 主要諸元表 2026-05（車両重量 1,420 kg、エンジン 54 kW・モーター 45 kW）",
  },
  patrol: {
    curbKg: 1690,
    powerKw: 180,
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.65,
    source:
      "Wikipedia「トヨタ・クラウン」版 110951464（15 代目 S22#: 車両重量 1,690–1,910 kg、2.0 L ターボ 180 kW。最軽量を 2.0 L ターボの ARS220 と仮定）",
  },
  unmarked: {
    curbKg: 1690,
    powerKw: 180,
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.65,
    source: "同上（覆面も同じ 15 代目のセダン）",
  },
  shirobai: {
    curbKg: 266 + 25,
    powerKw: 74,
    brake: BRAKE_BIKE,
    launchG: 0.6,
    cdA: 0.6,
    source:
      "Wikipedia「ホンダ・CB1300スーパーフォア」版 109756985（白バイ CB1300P の基のスーパーボルドール ABS 車両重量 266 kg・74 kW）＋ サイドボックス・無線機箱 25 kg（仮定）",
  },
  ambulance: {
    curbKg: 2580,
    powerKw: 111,
    brake: BRAKE_CAR,
    launchG: 0.4,
    cdA: 1.6,
    source:
      "Wikipedia「トヨタ・ハイメディック」版 110585047（3 代目 2WD 車両重量 2,580 kg。出力は未確認の仮定）",
  },
  sedan: {
    curbKg: 1350,
    powerKw: hybrid(72, 70),
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.62,
    source: "トヨタ カローラ（セダン）G 2WD 主要諸元表 2026-05（車両重量 1,350 kg）",
  },
  kei: {
    curbKg: 970,
    powerKw: 43,
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.8,
    source: "Wikipedia「ホンダ・N-BOX」版 110695185（3 代目 JF5/6: 車両重量 910–1,030 kg の中央、NA 43 kW）",
  },
  minivan: {
    curbKg: 1650,
    powerKw: 100,
    brake: BRAKE_CAR,
    launchG: 0.45,
    cdA: 0.9,
    source:
      "Wikipedia「トヨタ・ノア」版 110447722（4 代目 R90W: 1,600–1,710 kg の中央。出力は 3 代目ハイブリッドのシステム 100 kW）",
  },
  bus: {
    curbKg: 9700,
    powerKw: 177,
    brake: BRAKE_HEAVY,
    launchG: 0.3,
    cdA: 6,
    seats: 79,
    source:
      "環境省 低公害車ガイドブック 2017-2018 第2章7（日野ブルーリボン 2TG-KV290N2: 10,430 mm、車両重量 9,700 kg、定員 79 人、177 kW）",
  },
  truck10t: {
    curbKg: 11340,
    powerKw: 279,
    brake: BRAKE_HEAVY,
    launchG: 0.3,
    cdA: 7,
    payloadKg: 13500,
    source:
      "えびの興産「15トンウイング車」（車両重量 11.34 t、最大積載量 13.5 t）、出力は低公害車ガイドブックの いすゞギガ 2PG-CYL77C（279 kW）",
  },
  truck8t: {
    curbKg: 5840,
    powerKw: 154,
    brake: BRAKE_HEAVY,
    launchG: 0.3,
    cdA: 5.5,
    payloadKg: 8200,
    source:
      "えびの興産「8トン平低床車」（車両重量 5.84 t、最大積載量 8.2 t）、出力は低公害車ガイドブックの いすゞフォワード GVW8t（154 kW、増トン車の代わり）",
  },
  motorbike: {
    curbKg: 183,
    powerKw: 18,
    brake: BRAKE_BIKE,
    launchG: 0.6,
    cdA: 0.55,
    source: "スズキ GSR250（2012）主要諸元（車両重量 183 kg 装備、18 kW）",
  },
  bicycle: {
    curbKg: 20,
    powerKw: 0.15,
    brake: 4,
    launchG: 0.15,
    cdA: 0.5,
    source: "シティサイクル 20 kg（仮定。一次資料を確かめていない。ゲームにはまだ出てこない）",
  },
};

/**
 * 令和元年国民健康・栄養調査報告 第2部 第14表（身長・体重の平均値）と第15表（BMI の平均値）, by
 * sex and age band. The pedestrians' profiles have an age band (10代 = 15–19 歳) and a given name
 * that is a girl's or a boy's name.
 */
type BodyRow = { heightCm: number; bmi: number };
export const BODY_BY_AGE: Record<string, { male: BodyRow; female: BodyRow }> = {
  "10代": { male: { heightCm: 170.2, bmi: 21.1 }, female: { heightCm: 157.7, bmi: 20.2 } },
  "20代": { male: { heightCm: 171.5, bmi: 22.9 }, female: { heightCm: 157.5, bmi: 21.0 } },
  "30代": { male: { heightCm: 171.5, bmi: 23.7 }, female: { heightCm: 158.2, bmi: 21.7 } },
  "40代": { male: { heightCm: 171.5, bmi: 24.7 }, female: { heightCm: 158.1, bmi: 22.3 } },
  "50代": { male: { heightCm: 169.9, bmi: 24.6 }, female: { heightCm: 156.9, bmi: 22.4 } },
  "60代": { male: { heightCm: 167.4, bmi: 24.0 }, female: { heightCm: 154.0, bmi: 23.1 } },
  "70代": { male: { heightCm: 163.1, bmi: 23.4 }, female: { heightCm: 149.4, bmi: 22.9 } },
};

/** 20 歳以上の平均体重, men 67.4 kg and women 53.6 kg, averaged: a driver or passenger of either sex. */
export const ADULT_KG = (67.4 + 53.6) / 2;
/** A police officer: men of 30–49 (70.0, 72.8 kg) with the duty belt and vest (5 kg, assumed). */
export const OFFICER_KG = (70.0 + 72.8) / 2 + 5;
/** A 白バイ rider: the same man in helmet, boots, riding suit and vest (8 kg, assumed). */
export const RIDER_KG = (70.0 + 72.8) / 2 + 8;

/**
 * A pedestrian's mass from their age band and sex, scaled to their height: the band's mean height
 * times the model's height scale (around 1.0), at the band's mean BMI. Why BMI and not the mean
 * weight: the crowd's heights vary by ±8 %, and weight at the same build goes with height squared.
 */
export function personKg(age: string, female: boolean, heightScale = 1): number {
  const row = BODY_BY_AGE[age] ?? BODY_BY_AGE["40代"];
  const body = female ? row.female : row.male;
  const metres = (body.heightCm / 100) * heightScale;
  return body.bmi * metres * metres;
}

/**
 * What a traffic vehicle weighs with its driver, people and load, from a per-car number (its
 * serial) so the same car keeps its load: buses carry 5–40 people, trucks 0–100 % of their payload.
 */
export function laden(cls: MassClass, serial: number): number {
  const spec = VEHICLE_SPECS[cls];
  const share = ((serial >>> 3) % 101) / 100;
  const passengers = cls === "bus" ? 5 + Math.round(share * 35) : 0;
  const load = (spec.payloadKg ?? 0) * share;
  return spec.curbKg + ADULT_KG * (1 + passengers) + load;
}

/** Yaw (vertical-axis) moment of inertia of a uniform box of this mass and footprint (kg·m²). */
export function yawInertia(kg: number, length: number, width: number): number {
  return (kg * (length * length + width * width)) / 12;
}
