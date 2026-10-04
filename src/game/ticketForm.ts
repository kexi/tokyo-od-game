import type { ViolationRecord } from "./traffic";

export type TicketData = {
  /** 違反記録一覧（青切符または赤切符の対象） */
  violations: readonly ViolationRecord[];
  /** 告知書番号（例: 第 A123456 号 / 第 R654321 号） */
  ticketNumber?: string;
  /** 氏名 */
  driverName?: string;
  /** 生年月日（元号または西暦表記） */
  driverBirth?: string;
  /** 住所 / 住居 */
  driverAddress?: string;
  /** 免許証番号（架空） */
  licenseNumber?: string;
  /** 免許の種類（普通 など） */
  licenseType?: string;
  /** 車両の種類（普通乗用 など） */
  vehicleType?: string;
  /** 車両番号（ナンバープレート表記） */
  plateNumber?: string;
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
  label: string;
  article: string;
  isMatch: (v: ViolationRecord) => boolean;
}

const COMMON_VIOLATION_ENTRIES: CommonViolationEntry[] = [
  {
    id: "speed",
    label: "速度超過",
    article: "道交法22",
    isMatch: (v) => v.kind === "speed",
  },
  {
    id: "signal",
    label: "信号無視（赤色等）",
    article: "道交法7",
    isMatch: (v) => v.kind === "signal",
  },
  {
    id: "stopSign",
    label: "一時不停止等",
    article: "道交法43",
    isMatch: (v) => v.kind === "stopSign",
  },
  {
    id: "noEntry",
    label: "通行禁止違反",
    article: "道交法8-1",
    isMatch: (v) => v.kind === "noEntry" || v.kind === "turnBan" || v.kind === "closedRoad",
  },
  {
    id: "pedestrian",
    label: "横断歩行者妨害等",
    article: "道交法38",
    isMatch: (v) => v.kind === "pedestrianCrossing",
  },
  {
    id: "phone",
    label: "携帯電話使用等",
    article: "道交法71-5-5",
    isMatch: (v) => v.kind === "phone" || v.kind === "phoneDanger",
  },
  {
    id: "seatBelt",
    label: "座席ベルト装着義務",
    article: "道交法71-3",
    isMatch: (v) => v.kind === "seatBelt",
  },
  {
    id: "laneChange",
    label: "進路変更禁止違反",
    article: "道交法26の2",
    isMatch: (v) => v.kind === "laneChange",
  },
  {
    id: "laneUse",
    label: "通行帯違反",
    article: "道交法20",
    isMatch: (v) => v.kind === "laneUse" || v.kind === "laneDirection",
  },
  {
    id: "parking",
    label: "放置駐車違反",
    article: "道交法45",
    isMatch: (v) => v.kind === "parking" || v.kind === "parkingNoStop",
  },
  {
    id: "safeDriving",
    label: "安全運転義務違反",
    article: "道交法70",
    isMatch: (v) => v.kind === "safeDriving",
  },
  {
    id: "other",
    label: "その他",
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
 * 違反切符（青切符・赤切符）の HTML 文字列を生成する。
 */
export function renderTicketHtml(data: TicketData): string {
  const violations = data.violations;
  const isRed = violations.some((v) => v.fine === null);

  const totalPoints = violations.reduce((sum, v) => sum + v.points, 0);
  const totalFine = isRed ? null : violations.reduce((sum, v) => sum + (v.fine ?? 0), 0);

  const firstV = violations[0];
  const violationPlace = firstV?.context?.place ?? "東京都内一般道路";
  const violationClock = firstV?.context?.clock ?? "令和8年10月4日 11:30";

  // 速度超過の具体的な測定値（km/h）
  const speedV = violations.find((v) => v.kind === "speed");
  const hasSpeedMeasurement = speedV?.context?.kmh !== undefined;
  const speedDetail =
    hasSpeedMeasurement && speedV?.context
      ? `${Math.round(speedV.context.kmh)} km/h（${speedV.context.limit ? `${speedV.context.limit}km/h制限` : "法定"}：${Math.round(speedV.context.kmh - (speedV.context.limit ?? 60))}km/h超過）`
      : (speedV?.label.replace("速度超過（", "").replace("）", "") ?? "");

  const ticketNo = data.ticketNumber ?? generateTicketCode(isRed);
  const driverName = data.driverName ?? "運転者（本ゲームプレイヤー）";
  const driverBirth = data.driverBirth ?? "平成10年5月15日生";
  const driverAddress = data.driverAddress ?? "（免許証の記載による）";
  const licenseNumber = data.licenseNumber ?? "第 302612345678 号";
  const licenseType = data.licenseType ?? "普通（一種）";
  const vehicleType = data.vehicleType ?? "普通乗用自動車";
  const plateNumber = data.plateNumber ?? "品川 330 さ 12-34";
  const officerStation = data.officerStation ?? "交通機動隊";
  const officerRank = data.officerRank ?? "警部補";
  const officerName = data.officerName ?? "本田";
  const appearanceDate = data.appearanceDate ?? "告知の日の翌日から起算して7日以内";
  const appearancePlace = data.appearancePlace ?? getDefaultAppearancePlace(isRed);
  const paymentDeadline = data.paymentDeadline ?? "告知の日の翌日から起算して7日以内（金融機関窓口）";

  // 書式タイトル
  const headerTitle = isRed ? "交通事件原票・告知票（兼 免許証保管証）" : "交通反則告知書（兼 免許証保管証）";
  const subtitle = isRed ? "刑事手続（交通切符）による告知" : "道路交通法第126条の規定による告知";

  // 該当する違反条文まとめ
  const articlesList = violations.map((v) => v.article).join("、");

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
      const detailText = hasDetail ? `（${v.context?.detail}）` : "";
      return `
      <tr class="v-row">
        <td class="v-name handwritten">${v.label}${detailText}</td>
        <td class="v-art">${v.article}</td>
        <td class="v-pts">${v.points} 点</td>
        <td class="v-fine">${v.fine !== null ? `¥${v.fine.toLocaleString()}` : "非反則（裁判・罰金）"}</td>
      </tr>
    `;
    })
    .join("");

  // 納付書・出頭票部分（青切符なら納付書、赤切符なら出頭通告）
  const paymentSectionHtml = isRed
    ? `
      <div class="ticket-slip-section ticket-red-notice">
        <div class="slip-header">
          <span class="slip-tag">重要</span>
          <span class="slip-title">刑事手続・出頭通告書（非反則行為）</span>
        </div>
        <div class="slip-body">
          <p class="slip-warn">※ この違反は反則金制度（青切符）の適用対象外のため、金融機関での納付はできません。</p>
          <div class="slip-grid">
            <div class="slip-cell">
              <span class="c-lbl">出頭指定先</span>
              <span class="c-val handwritten">${appearancePlace}</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">出頭期日</span>
              <span class="c-val handwritten">後日送付される「呼出状（指定日時）」による</span>
            </div>
          </div>
          <p class="slip-desc">検察庁または家庭裁判所・簡易裁判所において略式命令または公判審理の手続が行われ、確定後に罰金等の納付となります。また、行政処分（免許停止・取消）の基準に達した場合は公安委員会より処分通知書が別途交付されます。</p>
        </div>
      </div>
    `
    : `
      <div class="ticket-slip-section ticket-blue-slip">
        <div class="slip-cut-line">
          <span>✂ キリトリ線 --------------------------------------------------------------------------------</span>
        </div>
        <div class="slip-header">
          <span class="slip-tag">保管証・仮納付書</span>
          <span class="slip-title">反則金仮納付書（日本銀行歳入代理店・各金融機関窓口納付用）</span>
        </div>
        <div class="slip-body">
          <div class="slip-grid">
            <div class="slip-cell">
              <span class="c-lbl">納付金額合計</span>
              <span class="c-val slip-amount handwritten">¥${(totalFine ?? 0).toLocaleString()}</span>
            </div>
            <div class="slip-cell">
              <span class="c-lbl">仮納付期限</span>
              <span class="c-val handwritten">${paymentDeadline}</span>
            </div>
            <div class="slip-cell full">
              <span class="c-lbl">納付場所</span>
              <span class="c-val">全国の銀行・信用金庫・信用組合・労働金庫・郵便局（簡易郵便局含む）の窓口</span>
            </div>
          </div>
          <p class="slip-note">※ 本納付書により期限内に仮納付したときは、公訴を提起されず、家庭裁判所の審判に付されません（道路交通法第128条第2項・第129条）。期日を過ぎた場合は通告センターへ出頭して本通告を受ける必要があります。</p>
        </div>
      </div>
    `;

  return `
    <div class="ticket-document ${isRed ? "ticket-red" : "ticket-blue"}">
      <div class="ticket-paper">
        <!-- ヘッダー部 -->
        <div class="t-head">
          <div class="t-top-row">
            <span class="t-code-box">告知番号 <strong class="handwritten">${ticketNo}</strong></span>
            <span class="t-form-name">${subtitle}</span>
            <span class="t-badge ${isRed ? "badge-red" : "badge-blue"}">${isRed ? "赤切符" : "青切符"}</span>
          </div>
          <h3 class="t-main-title">${headerTitle}</h3>
        </div>

        <!-- カーボン複写・書式本文グリッド -->
        <div class="t-grid-container">
          <!-- 違反者情報 -->
          <div class="t-row t-row-driver">
            <div class="t-cell lbl col-1"><span class="v-text">氏名</span></div>
            <div class="t-cell val col-3 handwritten driver-name">${driverName}</div>
            <div class="t-cell lbl col-1"><span class="v-text">生年月日</span></div>
            <div class="t-cell val col-3 handwritten">${driverBirth}</div>
          </div>

          <div class="t-row">
            <div class="t-cell lbl col-1"><span class="v-text">住居</span></div>
            <div class="t-cell val col-7 handwritten">${driverAddress}</div>
          </div>

          <div class="t-row">
            <div class="t-cell lbl col-1"><span class="v-text">免許証番号</span></div>
            <div class="t-cell val col-3 handwritten">${licenseNumber}</div>
            <div class="t-cell lbl col-1"><span class="v-text">免許種類</span></div>
            <div class="t-cell val col-3 handwritten">${licenseType}</div>
          </div>

          <div class="t-row">
            <div class="t-cell lbl col-1"><span class="v-text">車両の種類</span></div>
            <div class="t-cell val col-3 handwritten">${vehicleType}</div>
            <div class="t-cell lbl col-1"><span class="v-text">車両登録番号</span></div>
            <div class="t-cell val col-3 handwritten vehicle-plate">${plateNumber}</div>
          </div>

          <!-- 違反日時・場所 -->
          <div class="t-row">
            <div class="t-cell lbl col-1"><span class="v-text">違反日時</span></div>
            <div class="t-cell val col-3 handwritten">${violationClock} 頃</div>
            <div class="t-cell lbl col-1"><span class="v-text">違反場所</span></div>
            <div class="t-cell val col-3 handwritten place-val">${violationPlace}</div>
          </div>

          <!-- 違反事項チェック一覧 -->
          <div class="t-section-hdr">違反行為の種別（該当項目にチェック）</div>
          <div class="t-chk-grid">
            ${checklistHtml}
          </div>

          <!-- 告知違反内容一覧テーブル -->
          <div class="t-section-hdr">現認・告知された具体的違反事実</div>
          <table class="t-detail-tbl">
            <thead>
              <tr>
                <th>違反名 / 態様</th>
                <th>根拠条文</th>
                <th>点数</th>
                <th>反則金</th>
              </tr>
            </thead>
            <tbody>
              ${violationRowsHtml}
            </tbody>
            <tfoot>
              <tr class="t-foot-total">
                <td colspan="2" class="total-lbl">合計</td>
                <td class="total-pts handwritten"><strong>${totalPoints}</strong> 点</td>
                <td class="total-fine handwritten"><strong>${totalFine !== null ? `¥${totalFine.toLocaleString()}` : "非反則行為"}</strong></td>
              </tr>
            </tfoot>
          </table>

          <!-- 告知者・出頭期日等フッター情報 -->
          <div class="t-row t-row-bottom">
            <div class="t-col-left col-5">
              <div class="sub-cell">
                <span class="sub-lbl">出頭日時・場所:</span>
                <span class="sub-val handwritten">${appearancePlace}（${appearanceDate}）</span>
              </div>
              <div class="sub-cell">
                <span class="sub-lbl">適用条文:</span>
                <span class="sub-val">${articlesList}</span>
              </div>
            </div>
            <div class="t-col-right col-3 officer-box">
              <div class="officer-meta">
                <div>告知年月日: <span class="handwritten">${violationClock.split(" ")[0] ?? "令和8年10月4日"}</span></div>
                <div>所属: <span>${officerStation}</span></div>
                <div>告知者: <span>${officerRank}</span> <strong class="handwritten officer-name">${officerName}</strong></div>
              </div>
              <!-- 警察官の角印風スタンプ -->
              <div class="officer-seal">
                <span class="seal-inner">
                  <span class="seal-top">${officerName}</span>
                  <span class="seal-bot">之印</span>
                </span>
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
