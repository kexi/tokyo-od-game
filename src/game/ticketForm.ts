import type { ViolationRecord } from "./traffic";

export type TicketData = {
  /** 違反記録一覧（青切符または赤切符の対象） */
  violations: readonly ViolationRecord[];
  /** 告知書番号（例: 第 A123456 号 / 第 R654321 号） */
  ticketNumber?: string;
  /** 本籍（都道府県等） */
  driverDomicile?: string;
  /** 氏名 */
  driverName?: string;
  /** 生年月日（元号または西暦表記） */
  driverBirth?: string;
  /** 住所 / 住居 */
  driverAddress?: string;
  /** 職業 */
  driverOccupation?: string;
  /** 免許証番号（架空） */
  licenseNumber?: string;
  /** 免許の種類（普通 など） */
  licenseType?: string;
  /** 免許有効期限 */
  licenseExpiry?: string;
  /** 車両の種類（普通乗用 など） */
  vehicleType?: string;
  /** 車両番号（ナンバープレート表記） */
  plateNumber?: string;
  /** 車両通称名 */
  vehicleModel?: string;
  /** 告知警察官の所属・階級・氏名 */
  officerRank?: string;
  officerName?: string;
  officerStation?: string;
  /** 出頭期日・場所 */
  appearanceDate?: string;
  appearancePlace?: string;
  /** 納付期限 */
  paymentDeadline?: string;
};

/** よくある反則行為の一覧定義（反則告知書式チェックボックス再現用） */
interface CommonViolationEntry {
  id: string;
  code: string;
  label: string;
  article: string;
  isMatch: (v: ViolationRecord) => boolean;
}

const COMMON_VIOLATION_ENTRIES: CommonViolationEntry[] = [
  {
    id: "speed",
    code: "01",
    label: "速度超過",
    article: "道交法22",
    isMatch: (v) => v.kind === "speed",
  },
  {
    id: "signal",
    code: "02",
    label: "信号無視（赤色等）",
    article: "道交法7",
    isMatch: (v) => v.kind === "signal",
  },
  {
    id: "stopSign",
    code: "03",
    label: "一時不停止等",
    article: "道交法43",
    isMatch: (v) => v.kind === "stopSign",
  },
  {
    id: "noEntry",
    code: "04",
    label: "通行禁止違反",
    article: "道交法8-1",
    isMatch: (v) => v.kind === "noEntry" || v.kind === "turnBan" || v.kind === "closedRoad",
  },
  {
    id: "pedestrian",
    code: "05",
    label: "横断歩行者等妨害",
    article: "道交法38",
    isMatch: (v) => v.kind === "pedestrianCrossing",
  },
  {
    id: "phone",
    code: "06",
    label: "携帯電話使用等",
    article: "道交法71-5-5",
    isMatch: (v) => v.kind === "phone" || v.kind === "phoneDanger",
  },
  {
    id: "seatBelt",
    code: "07",
    label: "座席ベルト装着義務",
    article: "道交法71-3",
    isMatch: (v) => v.kind === "seatBelt",
  },
  {
    id: "laneChange",
    code: "08",
    label: "進路変更禁止違反",
    article: "道交法26の2",
    isMatch: (v) => v.kind === "laneChange",
  },
  {
    id: "laneUse",
    code: "09",
    label: "車両通行帯違反",
    article: "道交法20",
    isMatch: (v) => v.kind === "laneUse" || v.kind === "laneDirection",
  },
  {
    id: "parking",
    code: "10",
    label: "放置駐車違反",
    article: "道交法45",
    isMatch: (v) => v.kind === "parking" || v.kind === "parkingNoStop",
  },
  {
    id: "safeDriving",
    code: "11",
    label: "安全運転義務違反",
    article: "道交法70",
    isMatch: (v) => v.kind === "safeDriving",
  },
  {
    id: "other",
    code: "99",
    label: "その他反則行為",
    article: "道交法各条",
    isMatch: (v) => {
      const isHandled = [
        "speed",
        "signal",
        "stopSign",
        "noEntry",
        "turnBan",
        "closedRoad",
        "pedestrianCrossing",
        "phone",
        "phoneDanger",
        "seatBelt",
        "laneChange",
        "laneUse",
        "laneDirection",
        "parking",
        "parkingNoStop",
        "safeDriving",
      ].includes(v.kind);
      return !isHandled;
    },
  },
];

/**
 * 告知書の通し番号（架空）を生成する。
 */
function generateTicketCode(isRed: boolean): string {
  const prefix = isRed ? "赤" : "青";
  const num = Math.floor(100000 + Math.random() * 900000);
  return `第 ${prefix}-${num} 号`;
}

/**
 * 出頭場所。Why not the real offices' names and addresses: the game names no real organisation on
 * its documents; the generic names are what the forms' field means.
 */
function getDefaultAppearancePlace(isRed: boolean): string {
  if (isRed) return "検察庁・簡易裁判所（後日の呼出状で指定）";
  return "交通反則通告センター（告知書の案内による）";
}

/**
 * Entries come from map data (OpenStreetMap junction and town names) and the records; the form is
 * set as innerHTML, so every one is escaped. Why not building it with DOM nodes: the ruled layout
 * is far easier to read and keep as one template.
 */
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * 違反切符（青切符・赤切符）の HTML 文字列を生成する。
 */
export function renderTicketHtml(data: TicketData): string {
  const violations = data.violations;
  const isRed = violations.some((v) => v.fine === null);

  const totalPoints = violations.reduce((sum, v) => sum + v.points, 0);
  const totalFine = isRed ? null : violations.reduce((sum, v) => sum + (v.fine ?? 0), 0);

  const firstV = violations[0];
  const violationPlace = esc(firstV?.context?.place ?? "東京都内一般道路");
  const violationClock = esc(firstV?.context?.clock ?? "令和8年10月4日 11:30");

  // 速度超過の具体的な測定値（km/h）
  const speedV = violations.find((v) => v.kind === "speed");
  const hasSpeedMeasurement = speedV?.context?.kmh !== undefined;
  const speedDetail =
    hasSpeedMeasurement && speedV?.context
      ? `${Math.round(speedV.context.kmh)} km/h（${speedV.context.limit ? `${speedV.context.limit}km/h制限` : "法定"}：${Math.round(speedV.context.kmh - (speedV.context.limit ?? 60))}km/h超過）`
      : esc(speedV?.label.replace("速度超過（", "").replace("）", "") ?? "");

  const ticketNo = esc(data.ticketNumber ?? generateTicketCode(isRed));
  const driverDomicile = esc(data.driverDomicile ?? "東京都");
  const driverName = esc(data.driverName ?? "運転者（本ゲームプレイヤー）");
  const driverBirth = esc(data.driverBirth ?? "平成10年5月15日生");
  const driverAddress = esc(data.driverAddress ?? "（免許証記載の住所のとおり）");
  const driverOccupation = esc(data.driverOccupation ?? "会社員");
  const licenseNumber = esc(data.licenseNumber ?? "第 302612345678 号");
  const licenseType = esc(data.licenseType ?? "普通（一種）");
  const licenseExpiry = esc(data.licenseExpiry ?? "令和11年06月15日まで有効");
  const vehicleType = esc(data.vehicleType ?? "普通乗用自動車");
  const plateNumber = esc(data.plateNumber ?? "品川 330 さ 12-34");
  const vehicleModel = esc(data.vehicleModel ?? "自家用乗用");
  const officerStation = esc(data.officerStation ?? "交通機動隊");
  const officerRank = esc(data.officerRank ?? "警部補");
  const officerName = esc(data.officerName ?? "本田");
  const appearanceDate = esc(data.appearanceDate ?? "告知の日の翌日から起算して7日以内");
  const appearancePlace = esc(data.appearancePlace ?? getDefaultAppearancePlace(isRed));
  const paymentDeadline = esc(data.paymentDeadline ?? "告知の日の翌日から起算して7日以内（納付窓口）");

  // 書式タイトル・番号
  const formNumber = isRed ? "（事件迅速処理共用書式）" : "（道路交通法施行規則 別記様式第25）";
  const headerTitle = isRed ? "告知票（兼 免許証保管証）" : "交通反則告知書（兼 免許証保管証）";
  const headerSubTitle = isRed ? "交通事件原票・告知票（刑事手続）" : "道路交通法第126条の規定による告知";

  // チェックボックス欄の生成
  const checklistHtml = COMMON_VIOLATION_ENTRIES.map((entry) => {
    const isChecked = violations.some((v) => entry.isMatch(v));
    const checkMark = isChecked ? "☑" : "□";
    const highlightClass = isChecked ? "item-checked" : "";
    let extraNote = "";
    const isSpeedChecked = isChecked && entry.id === "speed" && speedDetail;
    if (isSpeedChecked) {
      extraNote = ` <span class="handwritten highlight-text">[${speedDetail}]</span>`;
    }
    return `
      <div class="chk-item ${highlightClass}">
        <span class="chk-code">${entry.code}</span>
        <span class="chk-box">${checkMark}</span>
        <span class="chk-label">${entry.label}</span>
        <span class="chk-art">(${entry.article})</span>${extraNote}
      </div>
    `;
  }).join("");

  // 違反具体内容・適用条文一覧
  const violationRowsHtml = violations
    .map((v) => {
      const hasDetail = Boolean(v.context?.detail);
      const detailText = hasDetail ? `（${esc(v.context?.detail ?? "")}）` : "";
      return `
      <tr class="v-row">
        <td class="v-name handwritten">${esc(v.label)}${detailText}</td>
        <td class="v-art">${esc(v.article)}</td>
        <td class="v-pts handwritten">${v.points} 点</td>
        <td class="v-fine handwritten">${v.fine !== null ? `¥${v.fine.toLocaleString()}` : "非反則（裁判手続）"}</td>
      </tr>
    `;
    })
    .join("");

  // 納付書・出頭票部分（青切符なら納付書、赤切符なら出頭通告）
  const paymentSectionHtml = isRed
    ? `
      <div class="ticket-slip-section ticket-red-notice">
        <div class="slip-perforation">
          <span class="perforation-text">┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈</span>
        </div>
        <div class="slip-header">
          <div class="slip-badge-group">
            <span class="slip-tag badge-red">刑事事件手続</span>
            <span class="slip-form-no">（交通部・検察庁送致用）</span>
          </div>
          <span class="slip-title">出頭通知票・手続案内書（非反則行為）</span>
        </div>
        <div class="slip-body">
          <p class="slip-warn">【重要】この違反は交通反則通告制度（反則金仮納付）の適用対象外です。銀行等の窓口での納付はできません。</p>
          <div class="slip-grid">
            <div class="slip-cell">
              <span class="c-lbl">指定出頭場所</span>
              <span class="c-val handwritten">${appearancePlace}</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">出頭期日・時間</span>
              <span class="c-val handwritten">後日送付される「呼出通知書（指定日時）」による</span>
            </div>
            <div class="slip-cell full">
              <span class="c-lbl">刑事手続及び行政処分等の案内</span>
              <span class="c-val slip-desc-text">
                検察庁または家庭裁判所・簡易裁判所において略式命令または公判審理の手続が行われ、確定後に罰金等の納付となります。また、累積点数が行政処分の基準に達した場合は公安委員会より処分通知書（免許停止・取消等）が別途交付されます。
              </span>
            </div>
          </div>
        </div>
      </div>
    `
    : `
      <div class="ticket-slip-section ticket-blue-slip">
        <div class="slip-perforation">
          <span class="perforation-text">┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈</span>
        </div>
        <div class="slip-header">
          <div class="slip-badge-group">
            <span class="slip-tag badge-blue">反則金仮納付書</span>
            <span class="slip-form-no">（日本銀行歳入代理店用）</span>
          </div>
          <span class="slip-title">交通反則金 仮納付書（兼 領収証書受領票）</span>
        </div>
        <div class="slip-body">
          <div class="slip-grid">
            <div class="slip-cell amount-cell">
              <span class="c-lbl">納付金額合計（円）</span>
              <span class="c-val slip-amount handwritten">¥${(totalFine ?? 0).toLocaleString()}</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">仮納付期限</span>
              <span class="c-val handwritten">${paymentDeadline}</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">納付取扱機関</span>
              <span class="c-val">日本銀行歳入代理店（全国の銀行・信用金庫・郵便局窓口）</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">収納バーコード・納付記号</span>
              <div class="slip-barcode-area">
                <span class="dummy-barcode">||| | |||| || ||||| |||| ||| ||||| || |</span>
                <span class="barcode-num handwritten">99820-0482-1084-3</span>
              </div>
            </div>
            <div class="slip-cell full">
              <span class="c-lbl">教示（留意事項）</span>
              <span class="c-val slip-desc-text">
                本納付書により納付期限内に仮納付したときは、公訴を提起されず、家庭裁判所の審判に付されません（道路交通法第128条第2項・第129条）。期日を過ぎた場合は通告センターへ出頭して本通告を受ける必要があります。コンビニエンスストアでの納付はできません。
              </span>
            </div>
          </div>
        </div>
      </div>
    `;

  return `
    <div class="ticket-document ${isRed ? "ticket-red" : "ticket-blue"}">
      <div class="ticket-paper">
        <!-- カーボン紙ヘッダー部 -->
        <div class="t-head">
          <div class="t-top-row">
            <div class="t-form-meta">
              <span class="t-form-no">${formNumber}</span>
              <span class="t-form-sub">${headerSubTitle}</span>
            </div>
            <div class="t-top-right">
              <div class="t-ticket-no-box">
                <span class="t-code-lbl">告知番号</span>
                <strong class="t-code-val handwritten">${ticketNo}</strong>
              </div>
              <span class="t-badge ${isRed ? "badge-red" : "badge-blue"}">${isRed ? "赤切符" : "青切符"}</span>
            </div>
          </div>
          <h3 class="t-main-title">${headerTitle}</h3>
        </div>

        <!-- 書式グリッド（二重枠・罫線区切り） -->
        <div class="t-grid-container">
          <!-- 1段目: 氏名・生年月日・本籍 -->
          <div class="t-row">
            <div class="t-cell lbl col-lbl"><span class="v-text">氏名</span></div>
            <div class="t-cell val col-name handwritten driver-name">${driverName}</div>
            <div class="t-cell lbl col-lbl"><span class="v-text">生年月日</span></div>
            <div class="t-cell val col-birth handwritten">${driverBirth}</div>
            <div class="t-cell lbl col-lbl-sm"><span class="v-text">本籍</span></div>
            <div class="t-cell val col-domicile handwritten">${driverDomicile}</div>
          </div>

          <!-- 2段目: 住居・職業 -->
          <div class="t-row">
            <div class="t-cell lbl col-lbl"><span class="v-text">住居</span></div>
            <div class="t-cell val col-addr handwritten">${driverAddress}</div>
            <div class="t-cell lbl col-lbl-sm"><span class="v-text">職業</span></div>
            <div class="t-cell val col-occ handwritten">${driverOccupation}</div>
          </div>

          <!-- 3段目: 免許証番号・免許種類・有効期限 -->
          <div class="t-row">
            <div class="t-cell lbl col-lbl"><span class="v-text">免許証番号</span></div>
            <div class="t-cell val col-lic-no handwritten">${licenseNumber}</div>
            <div class="t-cell lbl col-lbl"><span class="v-text">免許の種類</span></div>
            <div class="t-cell val col-lic-type handwritten">${licenseType}</div>
            <div class="t-cell lbl col-lbl-sm"><span class="v-text">有効期限</span></div>
            <div class="t-cell val col-lic-exp handwritten">${licenseExpiry}</div>
          </div>

          <!-- 4段目: 車両の種類・登録番号・通称名 -->
          <div class="t-row">
            <div class="t-cell lbl col-lbl"><span class="v-text">車両等の種類</span></div>
            <div class="t-cell val col-veh-type handwritten">${vehicleType}</div>
            <div class="t-cell lbl col-lbl"><span class="v-text">番号標等の表示</span></div>
            <div class="t-cell val col-veh-plate handwritten vehicle-plate">${plateNumber}</div>
            <div class="t-cell lbl col-lbl-sm"><span class="v-text">通称名</span></div>
            <div class="t-cell val col-veh-model handwritten">${vehicleModel}</div>
          </div>

          <!-- 5段目: 違反日時・場所 -->
          <div class="t-row">
            <div class="t-cell lbl col-lbl"><span class="v-text">違反日時</span></div>
            <div class="t-cell val col-clock handwritten">${violationClock} 頃</div>
            <div class="t-cell lbl col-lbl"><span class="v-text">違反場所</span></div>
            <div class="t-cell val col-place handwritten place-val">${violationPlace}</div>
          </div>

          <!-- 反則行為の種別 チェックボックス -->
          <div class="t-section-hdr">
            <span>反則行為の種別（該当項目にチェック）</span>
            <span class="hdr-sub-note">※ 道路交通法施行令別表第2参照</span>
          </div>
          <div class="t-chk-grid">
            ${checklistHtml}
          </div>

          <!-- 告知違反内容一覧テーブル -->
          <div class="t-section-hdr">
            <span>現認・告知された具体的違反事実及び適用条文</span>
          </div>
          <table class="t-detail-tbl">
            <thead>
              <tr>
                <th class="th-name">違反行為の種別 / 態様</th>
                <th class="th-art">適用条文</th>
                <th class="th-pts">基礎点数</th>
                <th class="th-fine">${isRed ? "罰則等の種別" : "反則金額"}</th>
              </tr>
            </thead>
            <tbody>
              ${violationRowsHtml}
            </tbody>
            <tfoot>
              <tr class="t-foot-total">
                <td colspan="2" class="total-lbl">合計</td>
                <td class="total-pts handwritten"><strong>${totalPoints}</strong> 点</td>
                <td class="total-fine handwritten"><strong>${totalFine !== null ? `¥${totalFine.toLocaleString()}` : "非反則（刑事手続）"}</strong></td>
              </tr>
            </tfoot>
          </table>

          <!-- 供述書（自認・署名押印）欄 & 告知者情報欄 -->
          <div class="t-row t-row-statement-officer">
            <!-- 左: 供述書欄 -->
            <div class="t-col-statement">
              <div class="statement-hdr">
                <span>供述書（任意）</span>
                <span class="statement-note">※ 署名押印（指印）は任意であり、強制されるものではありません。</span>
              </div>
              <div class="statement-body">
                <p class="statement-text">上記の日時、場所において告知された違反事実について間違いありません。</p>
                <div class="statement-sign-row">
                  <span class="sign-lbl">供述者署名:</span>
                  <span class="sign-val handwritten driver-name">${driverName}</span>
                  <div class="statement-fingerprint-box">
                    <span class="fingerprint-guide">（指印・印）</span>
                    <span class="stamp-fingerprint"></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 右: 告知警察官・出頭指定欄 -->
            <div class="t-col-officer">
              <div class="officer-sub-row">
                <span class="officer-lbl">出頭指定先:</span>
                <span class="officer-val handwritten">${appearancePlace}</span>
              </div>
              <div class="officer-sub-row">
                <span class="officer-lbl">出頭期日:</span>
                <span class="officer-val handwritten">${appearanceDate}</span>
              </div>
              <div class="officer-main-block">
                <div class="officer-meta">
                  <div>告知日: <span class="handwritten">${violationClock.split(" ")[0] ?? "令和8年10月4日"}</span></div>
                  <div>所属: <span>${officerStation}</span></div>
                  <div>告知者: <span>${officerRank}</span> <strong class="handwritten officer-name">${officerName}</strong></div>
                </div>
                <!-- 警察官個人印鑑（角印） -->
                <div class="officer-seal">
                  <span class="seal-inner">
                    <span class="seal-top">${officerName}</span>
                    <span class="seal-bot">之印</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 納付書 or 赤切符注記 -->
        ${paymentSectionHtml}
      </div>
    </div>
  `;
}

/**
 * 違反切符（青切符・赤切符）の DOM エレメントを生成する。
 */
export function renderTicket(data: TicketData): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderTicketHtml(data);
  const element = wrapper.firstElementChild as HTMLElement;
  return element ?? wrapper;
}
