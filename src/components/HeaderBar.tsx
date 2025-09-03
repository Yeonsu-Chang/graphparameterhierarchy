// src/components/HeaderBar.tsx
import { useEffect, useRef } from "react";
import { RefreshCw, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";

type Props = {
  title?: string;
  onReset?: () => void;
  // onSearch?: (q: string) => void; // (더 이상 사용하지 않음)
  onToggleOptions?: () => void;
  onTogglePanel?: () => void;
  panelCollapsed?: boolean;
  onOptionsAnchor?: (rect: DOMRect | null) => void; // 옵션 팝오버 위치 앵커
};

export default function HeaderBar({
  title = "Graph Parameter Hierarchy",
  onReset,
  // onSearch,  // (미사용)
  onToggleOptions,
  onTogglePanel,
  panelCollapsed = false,
  onOptionsAnchor,
}: Props) {
  // Options 버튼 앵커
  const optBtnRef = useRef<HTMLButtonElement | null>(null);

  // 최초/리사이즈 시 옵션 버튼 위치 부모에 전달
  useEffect(() => {
    const send = () =>
      onOptionsAnchor?.(
        optBtnRef.current ? optBtnRef.current.getBoundingClientRect() : null
      );
    send();
    window.addEventListener("resize", send);
    return () => window.removeEventListener("resize", send);
  }, [onOptionsAnchor]);

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b bg-white/90 backdrop-blur">
      {/* 좌-중-우 3열 */}
      <div className="mx-auto grid h-14 max-w-7xl grid-cols-3 items-center px-6">
        {/* LEFT: 패널 토글 */}
        <div className="flex items-center gap-3 justify-self-start">
          {onTogglePanel && (
            <button
              onClick={onTogglePanel}
              className="flex items-center gap-1 rounded-md bg-gray-700 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
              title={panelCollapsed ? "Show panel" : "Hide panel"}
            >
              {panelCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {/* CENTER: 사이트 제목만 */}
        <div className="flex items-center justify-center">
          <span className="text-lg font-semibold text-gray-800">{title}</span>
        </div>

        {/* RIGHT: 옵션 버튼(왼쪽) + 리셋 버튼(오른쪽) */}
        <div className="ml-auto flex items-center gap-3 justify-self-end">
          {onToggleOptions && (
            <button
              ref={optBtnRef}
              onClick={() => {
                // 클릭 시점의 위치도 갱신 (스크롤 등 반영)
                onOptionsAnchor?.(
                  optBtnRef.current
                    ? optBtnRef.current.getBoundingClientRect()
                    : null
                );
                onToggleOptions();
              }}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              title="Options"
            >
              <Settings className="h-4 w-4" />
              Options
            </button>
          )}

          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              title="Reset"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
