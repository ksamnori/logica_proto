// src/lib/useClinicSeatKeys.ts
// 클리닉 화면(학생 portal/viewer, TA pad, supervisor)에서 좌석 "목록"이 필요할 때 쓰는 공용 훅.
// 기존에는 각 화면이 SEAT_ROWS/SEAT_COLS로 "A-01".."F-10"을 직접 만들어 썼지만, 이제 좌석 배치
// 에디터가 저장한 실제 배치(좌석 번호 1..N)를 서버 액션으로 가져와 쓴다.
"use client";

import { useEffect, useRef, useState } from "react";
import { getActiveSeatLayout } from "@/app/actions/clinicSeatLayout";
import { Seat, SEAT_LAYOUT_UPDATED_EVENT } from "@/lib/clinicSeatLayout";

export interface ClinicSeatKeysResult {
    seats: Seat[];
    seatKeys: string[]; // seat.number를 문자열로. 기존 "A-01" 스타일 키를 대체.
    loaded: boolean;
}

// realtimeChannel을 이미 만들어 쓰고 있는 화면이면 그 채널을 넘겨 'layout_updated' 브로드캐스트를
// 재사용한다(채널을 새로 만들지 않음). 없으면 목록을 최초 1회만 가져온다.
export function useClinicSeatKeys(channel?: any): ClinicSeatKeysResult {
    const [seats, setSeats] = useState<Seat[]>([]);
    const [loaded, setLoaded] = useState(false);
    const mountedRef = useRef(true);

    const reload = () => {
        getActiveSeatLayout().then(layout => {
            if (!mountedRef.current) return;
            setSeats([...layout.seats].sort((a, b) => a.number - b.number));
            setLoaded(true);
        });
    };

    useEffect(() => {
        mountedRef.current = true;
        reload();
        return () => { mountedRef.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!channel) return;
        channel.on('broadcast', { event: SEAT_LAYOUT_UPDATED_EVENT }, () => reload());
        // 💡 채널의 .on()은 그 시점에 등록만 하고, 실제 subscribe()는 각 화면이 직접 호출한다
        // (이미 다른 이벤트들과 함께 한 번만 subscribe해야 하므로 여기서 다시 부르지 않는다).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel]);

    return { seats, seatKeys: seats.map(s => String(s.number)), loaded };
}
