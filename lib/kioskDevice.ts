// src/lib/kioskDevice.ts
// 키오스크 앱(예: Fully Kiosk Browser)이 페이지에 노출하는 기기 고유 식별자를 읽어온다.
// 실제로 어떤 키오스크 앱을 쓸지, 그 앱이 노출하는 정확한 전역 객체/메서드 이름이 아직
// 확정되지 않아서, 알려진 후보들을 순서대로 시도한다. 실제 패드에서 콘솔로 window를 찍어
// 정확한 이름이 확인되면 CANDIDATE_GETTERS만 고치면 되고, 이 함수를 호출하는 쪽(로그인
// 화면 등)은 손댈 필요 없다.
declare global {
    interface Window {
        fully?: any;
        Fully?: any;
    }
}

const CANDIDATE_GETTERS: Array<() => string | undefined> = [
    () => window.fully?.getDeviceId?.(),
    () => window.Fully?.getDeviceId?.(),
    () => window.fully?.deviceId,
    // 개발/테스트용 폴백 — 실제 키오스크 앱 없이도 흐름을 검증할 수 있게, localStorage에
    // __kiosk_test_device_id가 있으면 그걸 기기ID로 취급한다. 운영 중인 실제 패드에선
    // 아무도 이 키를 채우지 않으니 영향 없다.
    () => localStorage.getItem('__kiosk_test_device_id') || undefined,
];

// 브라우저(키오스크 앱 웹뷰) 환경이 아니거나, 지원되는 키오스크 앱이 아니면 null을 반환한다.
export function getKioskDeviceId(): string | null {
    if (typeof window === 'undefined') return null;
    for (const getter of CANDIDATE_GETTERS) {
        try {
            const id = getter();
            if (id) return String(id);
        } catch (e) {}
    }
    return null;
}
