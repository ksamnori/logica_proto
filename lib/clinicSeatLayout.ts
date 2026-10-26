// src/lib/clinicSeatLayout.ts
// 클리닉 좌석 "배치"(좌표)의 단일 소스. 좌석 "점유"(누가 앉아있는지)는 여전히
// clinic_session_state가 담당한다 — 이 파일은 좌석이 어디에, 몇 번으로 존재하는지만 다룬다.

export interface Seat {
    id: string;      // 안정적인 내부 id (drag 중에도 번호와 별개로 유지)
    number: number;  // 화면에 보이는 좌석 번호 (1..N, reading-order로 재계산됨)
    x: number;       // 가상 캔버스 기준 절대좌표
    y: number;
}

export interface SeatLayout {
    id: string;
    canvasWidth: number;
    canvasHeight: number;
    seatWidth: number;
    seatHeight: number;
    seats: Seat[];
    updatedAt: string;
    updatedBy: string | null;
}

// 수퍼바이저 모니터가 2560x1440급으로 큰 것을 기준으로, 카드 안 텍스트(이름/반/타이머/버튼 등
// 여러 줄)가 다 들어갈 만큼 좌석 높이를 넉넉히 잡은 값이다.
export const DEFAULT_CANVAS_W = 1740;
export const DEFAULT_CANVAS_H = 1280;

// 좌석 카드 크기의 기본값(캔버스 좌표 기준) — 아직 저장된 배치가 없을 때만 쓰는 폴백이다.
// 실제 크기는 이제 좌석 배치 에디터에서 조절해 각 배치(SeatLayout)에 저장되므로, 화면들은
// 이 상수 대신 반드시 layout.seatWidth/seatHeight를 써야 두 화면이 항상 같은 크기로 보인다.
export const DEFAULT_SEAT_CARD_W = 200;
export const DEFAULT_SEAT_CARD_H = 120;

// 신규 좌석 배치가 아직 저장되지 않았을 때 쓰는 기본값(기존 6x10 그리드와 동일한 자리 배치, 좌표만 부여)
export function buildDefaultSeats(): Seat[] {
    const rows = 6, cols = 10;
    const marginX = 80, marginY = 100;
    const stepX = (DEFAULT_CANVAS_W - marginX * 2) / (cols - 1);
    const stepY = (DEFAULT_CANVAS_H - marginY * 2) / (rows - 1);
    const seats: Seat[] = [];
    let n = 1;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            seats.push({ id: `seat_${n}`, number: n, x: marginX + c * stepX, y: marginY + r * stepY });
            n++;
        }
    }
    return seats;
}

// 좌석 번호(1..N)를 reading-order(위→아래, 가까운 행은 왼쪽→오른쪽)로 재계산한다.
// 완전히 같은 y가 아니어도 "같은 행"으로 묶이도록 캔버스 대비 상대적인 허용오차를 둔다.
export function renumberSeats(seats: Seat[], canvasHeight = DEFAULT_CANVAS_H): Seat[] {
    const rowTolerance = canvasHeight * 0.04;
    const sorted = [...seats].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: Seat[][] = [];
    for (const seat of sorted) {
        const lastRow = rows[rows.length - 1];
        const rowAnchorY = lastRow ? lastRow[0].y : null;
        if (lastRow && rowAnchorY !== null && Math.abs(seat.y - rowAnchorY) <= rowTolerance) {
            lastRow.push(seat);
        } else {
            rows.push([seat]);
        }
    }
    let n = 1;
    const renumbered: Seat[] = [];
    for (const row of rows) {
        row.sort((a, b) => a.x - b.x);
        for (const seat of row) {
            renumbered.push({ ...seat, number: n });
            n++;
        }
    }
    return renumbered;
}

// 화면 표시용 라벨 — 기존 "A-01"→"A1" 포맷터(formatSeat)를 대체한다. 좌석 키 자체가 이미 번호이므로 그대로 반환.
export function formatSeatLabel(seatKey: string | number): string {
    return String(seatKey);
}

// 좌석 배치가 바뀌었을 때 클리닉 화면들에게 알리는 공용 브로드캐스트 이벤트 이름.
// 에디터가 저장 시 이 이벤트를 쏘고, 클리닉 화면들은 이를 구독해 좌석 목록을 다시 불러온다.
export const SEAT_LAYOUT_UPDATED_EVENT = 'layout_updated';
