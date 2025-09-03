// src/pages/GraphHierarchy.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { NODES, EDGE_LIST } from "@/data/graph-data";
import HeaderBar from "@/components/HeaderBar";
import "katex/dist/katex.min.css";
import katex from "katex";
import nodeHtmlLabel from "cytoscape-node-html-label";

// -------- Register plugins (safe) --------
try { cytoscape.use(dagre); } catch { /* hot-reload guard */ }

// ---------- helpers ----------
const SLUG_RULES_VERSION = 4 as const;

const toId = (s: string) =>
  String(s)
    .normalize("NFKD")
    .replace(/∞/g, "infty")
    .replace(/[–—−]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const toDisplay = (s: string) =>
  String(s).replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

// --- TeX label helper ---
const toTex = (lab: string) => {
  let s = lab.trim();
  s = s.replace(/∞/g, "\\infty");
  s = s.replace(/\?infty/g, "\\infty");
  const parts = s.split("-").map((p) => p.trim()).filter(Boolean);
  const texParts = parts.map((p) => {
    if (p === "r" || p === "$r$" || p === "\\mathit{r}") return "r";
    if (p === "\\infty") return "\\infty";
    return `\\text{${p}}`;
  });
  return texParts.join(" - ");
};

// 텍스트 검색용 정규화: 대시/무한대/대소문자/공백 통일
function norm(q: string) {
  return String(q)
    .normalize("NFKD")
    .replace(/∞/g, "infty")
    .replace(/[–—−]/g, "-")
    .toLowerCase()
    // 검색 매칭을 위해 구분자들을 공백으로
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---- Node safe-cast (NodeSingular | Collection → NodeSingular) ----
  type NodeLike =
    | cytoscape.NodeSingular
    | cytoscape.Collection
    | cytoscape.SingularElementReturnValue
    | null
    | undefined;

  function asNode(target: NodeLike): cytoscape.NodeSingular | null {
    if (!target) return null;
    try {
      // collection/싱귤러 모두 대응
      const first =
        (target as cytoscape.Collection).nodes?.().first?.() ??
        ((target as any).isNode && (target as any).isNode() ? target : null);
      return first && first.length ? (first as cytoscape.NodeSingular) : null;
    } catch {
      return null;
    }
  }


export default function GraphHierarchy() {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  // -------------------- UI state --------------------
  const [panelFilter, setPanelFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eqSortAsc, setEqSortAsc] = useState(true);
  const [showOptions, setShowOptions] = useState(false);
  const [optAnchor, setOptAnchor] = useState<DOMRect | null>(null);

  // layout restore storage (for temporary clustering)
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // k-neighbor (OFF/1/2)
  const [k, setK] = useState<0 | 1 | 2>(0);
  const kRef = useRef<0 | 1 | 2>(0);
  useEffect(() => { kRef.current = k; }, [k]);

  // Panel collapse state
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) { recenterGraph(); return; }

    let done = false;
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "margin" || done) return;
      done = true;
      recenterGraph();
      el.removeEventListener("transitionend", onEnd);
    };
    const fallback = setTimeout(() => { if (!done) recenterGraph(); }, 240);
    el.addEventListener("transitionend", onEnd);
    return () => { clearTimeout(fallback); el.removeEventListener("transitionend", onEnd); };
  }, [panelCollapsed]);

  // -------------------- Build elements & equivalence map --------------------
  const { elements, allLabelsSorted, eqMapById } = useMemo(() => {
    const edges = (Array.isArray(EDGE_LIST) ? EDGE_LIST : []) as (readonly [string, string, "bi"?])[];
    const normals: cytoscape.ElementDefinition[] = [];
    const draw = new Set<string>();
    const biAdj = new Map<string, Set<string>>();

    for (const [s, t, d] of edges) {
      if (d === "bi") {
        if (!biAdj.has(s)) biAdj.set(s, new Set());
        if (!biAdj.has(t)) biAdj.set(t, new Set());
        biAdj.get(s)!.add(t); biAdj.get(t)!.add(s);
      } else {
        draw.add(s); draw.add(t);
        normals.push({ data: { id: `e-${toId(s)}-${toId(t)}`, source: toId(s), target: toId(t) } });
      }
    }

    const nodes = Array.from(draw).map((lab) => ({
      data: {
        id: toId(lab),
        label: toDisplay(lab),
        raw: lab,
        texLabel: toTex(lab),
      },
    }));
    const elements = [...nodes, ...normals];

    // All labels for side panel (include bi neighbors as well)
    const all = new Set<string>(Array.isArray(NODES) ? NODES : []);
    biAdj.forEach((s) => s.forEach((lab) => all.add(lab)));
    const allLabelsSorted = Array.from(all).sort((a, b) => toDisplay(a).localeCompare(toDisplay(b)));

    // Direct bi-neighbors as equivalents (no CC closure)
    const eqMapById = new Map<string, string[]>();
    Array.from(all).forEach((lab) => {
      const id = toId(lab);
      const neighbors = biAdj.has(lab) ? Array.from(biAdj.get(lab)!) : [];
      eqMapById.set(id, [lab, ...neighbors]); // self 포함, UI에서 self 제외
    });

    return { elements, allLabelsSorted, eqMapById };
  }, [SLUG_RULES_VERSION]);

  // -------------------- Styles --------------------
  const style = useMemo(() => ([
    { selector: "node", style: {
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": "320px",
      "text-valign": "center",
      "text-halign": "center",
      width: "label",
      height: "label",
      padding: "10px",
      "font-size": 15,
      color: "transparent", // KaTeX로 대체
      "background-color": "#d5f5ff",
      "border-color": "#c9e0ff",
      "border-width": 2,
      shape: "round-rectangle",
    } as any },
    { selector: "edge", style: {
      width: 1.5,
      "line-color": "#64748b",
      "line-opacity": 0.95,
      "target-arrow-color": "#64748b",
      "target-arrow-shape": "triangle",
      "arrow-scale": 1.35,
      "curve-style": "bezier",
    } as any },
    // highlight / dimming
    { selector: "node.NH_OUT", style: { "border-color": "#2563eb", "border-width": 3, "background-color": "#9cfffc" } as any },
    { selector: "node.NH_IN",  style: { "border-color": "#16a34a", "border-width": 3, "background-color": "#a2ffad" } as any },
    { selector: "edge.EH_OUT", style: { "line-color": "#2563eb", "target-arrow-color": "#2563eb", width: 6 } as any },
    { selector: "edge.EH_IN",  style: { "line-color": "#16a34a", "target-arrow-color": "#16a34a", width: 6 } as any },
    { selector: "node.SEL", style: { "border-color": "#dc2626", "border-width": 3, "background-color": "#fee2e2" } as any },
    { selector: "node.dim", style: {
        opacity: 0.08,
        "text-opacity": 0.08,
        "background-opacity": 0.08,
        "border-color": "#e5e7eb",
        "border-width": 1,
      } as any },
    { selector: "edge.dim", style: {
        opacity: 0.08,
        "line-opacity": 0.08,
        "line-color": "#e5e7eb",
        "target-arrow-color": "#e5e7eb",
        width: 1,
        "arrow-scale": 0.9,
      } as any },
  ]) as any, []);

  // -------------------- Graph init --------------------
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    cyRef.current?.destroy(); cyRef.current = null;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style,
      layout: { name: "grid", fit: true } as any,
      wheelSensitivity: 0.18,
      pixelRatio: window.devicePixelRatio || 1,
      textureOnViewport: false,
    });

    // Attach HTML labels rendered by KaTeX (recommended pattern)
    try {
      (nodeHtmlLabel as any)(cy, [
        {
          query: "node",
          halign: "center",
          valign: "center",
          tpl: (data: any) => {
            const latex = data?.texLabel ?? toTex(data?.label || "");
            try {
              const html = katex.renderToString(latex, { throwOnError: false });
              return `<div class="klabel" id="klabel-${data?.id ?? ""}" style="pointer-events:none">${html}</div>`;
            } catch {
              const fallback = (data?.label || "").toString();
              return `<div class="klabel" id="klabel-${data?.id ?? ""}" style="pointer-events:none">${fallback}</div>`;
            }
          },
        },
      ]);
    } catch {
      // ignore
    }

    const runLayout = () => {
      try {
        cy.layout({
          name: "dagre",
          rankDir: "TB",
          nodeSep: 52,
          rankSep: 108,
          edgeSep: 28,
          animate: true,
          animationDuration: 180,
        } as any).run();
        cy.fit(undefined, 64);
        if (cy.zoom() > 1.0) cy.zoom(1.0);
      } finally {}
    };

    const ric: any = (globalThis as any).requestIdleCallback;
    cy.one("render", () => { ric ? ric(runLayout) : setTimeout(runLayout, 0); });

    // Node tap (중앙 이동 X)
    cy.on("tap", "node", (e) => {
      const n = e.target as cytoscape.NodeSingular;
      setSelectedId(n.id());
      updateHL(n.id()); // k=0 포함 상태머신
      positionEqButton(n);
      showEqBtn();
    });

    // Background tap → reset
    cy.on("tap", (e) => {
      if (e.target === cy) {
        clearHL();
        cy.nodes().removeClass("SEL dim");
        setSelectedId(null);
        hideEqAll();
        restorePositionsIfAny();
      }
    });

    cyRef.current = cy;

    // keep EQ button positioned on viewport/resize
    const onViewport = () => {
      if (!selectedId) return;
      const n = cy.getElementById(selectedId);
      if (n && n.length) queueReposition(() => positionEqButton(n));
    };
    cy.on("viewport", onViewport);

    const onResize = () => {
      cy.resize();
      if (!selectedId) return;
      const n = cy.getElementById(selectedId);
      if (n && n.length) queueReposition(() => positionEqButton(n));
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cy.removeListener("viewport", onViewport);
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, style]);

  // -------------------- k-neighbor infra --------------------
  const outRef = useRef(new Map<string, Set<string>>());
  const inRef  = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    outRef.current.clear(); inRef.current.clear();
    cy.nodes().forEach((n) => { const id = n.id(); outRef.current.set(id, new Set()); inRef.current.set(id, new Set()); });
    cy.edges().forEach((e) => { const u = e.source().id(), v = e.target().id(); outRef.current.get(u)!.add(v); inRef.current.get(v)!.add(u); });
  }, [elements]);

  // ===== Fast width cache (DOM px -> model units) =====
    function invalidateWidthCache() {
      widthCacheRef.current.map.clear();
      widthCacheRef.current.zoom = cyRef.current?.zoom() ?? 1;
    }

    // 줌/팬/리사이즈 때만 캐시 무효화
    useEffect(() => {
      const cy = cyRef.current;
      if (!cy) return;
      const onView = () => invalidateWidthCache();
      cy.on("zoom pan", onView);
      window.addEventListener("resize", onView);
      return () => {
        cy.removeListener("zoom pan", onView);
        window.removeEventListener("resize", onView);
      };
    }, []);

    // HTML 라벨(px) 폭을 읽어 모델 좌표로 환산 + 캐시
    // HTML 라벨(px) → 모델좌표로 환산(+약간의 패딩)
    const widthCacheRef = useRef<{ zoom:number; map: Map<string, number> }>({ zoom: 1, map: new Map() });
    const heightCacheRef = useRef<{ zoom:number; map: Map<string, number> }>({ zoom: 1, map: new Map() });

    function invalidateLabelSizeCache() {
      const z = cyRef.current?.zoom() ?? 1;
      widthCacheRef.current.zoom = z;   widthCacheRef.current.map.clear();
      heightCacheRef.current.zoom = z;  heightCacheRef.current.map.clear();
    }

    useEffect(() => {
      const cy = cyRef.current; if (!cy) return;
      const onView = () => invalidateLabelSizeCache();
      cy.on("zoom pan", onView);
      window.addEventListener("resize", onView);
      return () => { cy.removeListener("zoom pan", onView); window.removeEventListener("resize", onView); };
    }, []);

    function measureNodeWidthModel(id: string): number {
      const cy = cyRef.current; if (!cy) return 120;
      const z = cy.zoom(), cache = widthCacheRef.current;
      if (cache.zoom === z && cache.map.has(id)) return cache.map.get(id)!;
      const el = document.getElementById(`klabel-${id}`) as HTMLElement | null;
      let px = el?.offsetWidth ?? 120;
      if (!Number.isFinite(px) || px <= 0) px = 120;
      const model = px / z + 24; // 여유
      cache.zoom = z; cache.map.set(id, model);
      return model;
    }
    function measureNodeHeightModel(id: string): number {
      const cy = cyRef.current; if (!cy) return 40;
      const z = cy.zoom(), cache = heightCacheRef.current;
      if (cache.zoom === z && cache.map.has(id)) return cache.map.get(id)!;
      const el = document.getElementById(`klabel-${id}`) as HTMLElement | null;
      let px = el?.offsetHeight ?? 24;
      if (!Number.isFinite(px) || px <= 0) px = 24;
      const model = px / z + 18; // 여유
      cache.zoom = z; cache.map.set(id, model);
      return model;
    }

    // =====================================================

    // ===== RAF debounce for clustering =====
      const clusterRAFRef = useRef<number | null>(null);
      function clusterSelectionWithNeighborsQueued(K: 0 | 1 | 2) {
        if (clusterRAFRef.current) cancelAnimationFrame(clusterRAFRef.current);
        clusterRAFRef.current = requestAnimationFrame(() => {
          clusterSelectionWithNeighbors(K);
        });
      }
      // ======================================



  const bfs = (root: string, K: number, ADJ: Map<string, Set<string>>) => {
    const dist = new Map<string, number>([[root, 0]]); const q: string[] = [root];
    while (q.length) {
      const u = q.shift()!, du = dist.get(u)!;
      if (du === K) continue;
      (ADJ.get(u) ?? new Set()).forEach(v => {
        if (!dist.has(v)) { dist.set(v, du + 1); q.push(v); }
      });
    }
    return new Set(dist.keys());
  };

  function bfsDist(root: string, K: number, ADJ: Map<string, Set<string>>) {
    const dist = new Map<string, number>([[root, 0]]);
    const q: string[] = [root];
    while (q.length) {
      const u = q.shift()!, du = dist.get(u)!;
      if (du === K) continue;
      (ADJ.get(u) ?? new Set()).forEach(v => {
        if (!dist.has(v)) { dist.set(v, du + 1); q.push(v); }
      });
    }
    return dist; // root is 0
  }

  function recenterGraph() {
    const cy = cyRef.current; if (!cy) return;
    const z = cy.zoom();
    cy.resize();
    cy.center(cy.nodes());
    cy.zoom(z);
  }

  // Sync opacity of KaTeX HTML labels with Cytoscape dim class
  function syncHtmlLabelOpacity() {
    const cy = cyRef.current; if (!cy) return;
    cy.nodes().forEach((n) => {
      const el = document.getElementById(`klabel-${n.id()}`);
      if (el) (el as HTMLElement).style.opacity = n.hasClass("dim") ? "0.08" : "1";
    });
  }

  // --- highlight primitives ---
  const clearHL = () => {
    const cy = cyRef.current; if (!cy) return;
    cy.batch(() => {
      cy.nodes().removeClass("NH_OUT NH_IN SEL dim");
      cy.edges().removeClass("EH_OUT EH_IN dim");
      cy.nodes().removeStyle();
      cy.edges().removeStyle();
    });
    syncHtmlLabelOpacity();
  };

  const applyHL = (nodeId: string, kk: 0 | 1 | 2) => {
    const cy = cyRef.current; if (!cy) return;
    if (kk === 0) {
      // k=0: 디밍 금지, 선택만 표시
      cy.batch(() => {
        cy.nodes().removeClass("NH_OUT NH_IN dim");
        cy.edges().removeClass("EH_OUT EH_IN dim");
        cy.nodes().removeStyle();
        cy.edges().removeStyle();
        cy.nodes().removeClass("SEL");
        cy.getElementById(nodeId).addClass("SEL");
      });
      syncHtmlLabelOpacity();
      return;
    }

    clearHL();

    const outSet = bfs(nodeId, kk, outRef.current);
    const inSet  = bfs(nodeId, kk, inRef.current);

    cy.batch(() => {
      cy.nodes().addClass("dim");
      cy.edges().addClass("dim");

      cy.nodes().forEach((n) => {
        const id = n.id();
        let hit = false;
        if (outSet.has(id)) { n.addClass("NH_OUT"); hit = true; }
        if (inSet.has(id))  { n.addClass("NH_IN");  hit = true; }
        if (hit) n.removeClass("dim");
      });
      cy.edges().forEach((e) => {
        const s = e.source().id(), t = e.target().id();
        if (outSet.has(s) && outSet.has(t)) { e.addClass("EH_OUT"); e.removeClass("dim"); }
        if (inSet.has(s) && inSet.has(t))  { e.addClass("EH_IN");  e.removeClass("dim"); }
      });

      const sel = cy.getElementById(nodeId) as cytoscape.NodeSingular;
      sel.removeClass("dim NH_OUT NH_IN");
      sel.addClass("SEL");
    });
    syncHtmlLabelOpacity();
  };

  // Centralized HL state machine
  const lastHLRef = useRef<{ nid: string | null; k: 0 | 1 | 2 } | null>(null);
  const updatingRef = useRef(false);
  const updateHL = (nid: string | null) => {
    const cy = cyRef.current; if (!cy) return;
    if (updatingRef.current) return;
    updatingRef.current = true;

    try {
      if (!nid) { clearHL(); lastHLRef.current = { nid: null, k: kRef.current }; return; }
      const curK = kRef.current;
      if (lastHLRef.current && lastHLRef.current.nid === nid && lastHLRef.current.k === curK) {
        if (curK === 0) {
          cy.batch(() => {
            cy.edges().removeClass("EH_OUT EH_IN dim");
            cy.nodes().removeClass("dim");
            cy.nodes().removeClass("SEL");
            const selEl = cy.getElementById(nid);
            if (selEl && selEl.length) selEl.addClass("SEL");
          });
          syncHtmlLabelOpacity();
        }
        lastHLRef.current = { nid, k: curK };
        return;
      }
      applyHL(nid, curK);
      lastHLRef.current = { nid, k: curK };
    } finally {
      updatingRef.current = false;
    }
  };

  // -------------------- cluster layout for neighbors --------------------
  function clusterSelectionWithNeighbors(K: 0 | 1 | 2) {
    const cy = cyRef.current; if (!cy) return;
    // Guard: K === 0 → 아무 것도 하지 않음 (OFF)
    if (K === 0 || !selectedId) return;

    // restore previous positions before clustering
    restorePositionsIfAny();

    const selNode = cy.getElementById(selectedId);
    if (!selNode || selNode.length === 0) return;
    const root = selNode.id();

    const inDist  = bfsDist(root, K, inRef.current);
    const outDist = bfsDist(root, K, outRef.current);

    const inIds  = new Set<string>();
    const outIds = new Set<string>();
    inDist.forEach((d, id)  => { if (typeof d === "number" && d > 0 && d <= K) inIds.add(id); });
    outDist.forEach((d, id) => { if (typeof d === "number" && d > 0 && d <= K) outIds.add(id); });

    const both = new Set<string>();
    inIds.forEach((id) => { if (outIds.has(id)) both.add(id); });
    const inOnly  = new Set([...inIds].filter((x) => !both.has(x)));
    const outOnly = new Set([...outIds].filter((x) => !both.has(x)));

    const ids = new Set<string>([root, ...inOnly, ...outOnly, ...both]);

    const origPos = new Map<string, { x: number; y: number }>();
    let nodes = cy.collection();
    ids.forEach((id) => {
      const n = cy.getElementById(id);
      if (n && n.length && n.isNode && n.isNode()) {
        nodes = nodes.union(n);
        const p = n.position();
        origPos.set(id, { x: p.x, y: p.y });
        if (!savedPositionsRef.current.has(id)) {
          savedPositionsRef.current.set(id, { x: p.x, y: p.y });
        }
      }
    });
    if (nodes.length === 0) return;

    const { x: cx, y: cyy } = selNode.position();
    // HTML 라벨 높이를 반영한 동적 세로 간격
    const BASE_GAP = 32;                // 가로 기본 간격(필요시 조절)
    const V_PAD    = 28;                // 레이어 사이 여유
    const MAX_H = [...ids].reduce((m, id) => Math.max(m, measureNodeHeightModel(id)), 32);
    const layerGap = Math.max(96, Math.ceil(MAX_H + V_PAD));  // ✅ 세로 겹침 방지

    const placeToIn = true;

    const rows = new Map<string, string[]>();
    const yOf  = new Map<string, number>();

    const pushRow = (dir: "IN" | "OUT", dRaw: unknown, id: string) => {
      const d = typeof dRaw === "number" ? dRaw : NaN;
      if (!(d >= 1 && d <= K)) return;
      const key = `${dir}:${d}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key)!.push(id);
      if (!yOf.has(key)) {
        const yVal = dir === "IN" ? cyy - d * layerGap : cyy + d * layerGap;
        yOf.set(key, Number.isFinite(yVal) ? yVal : cyy);
      }
    };

    inOnly.forEach((id)  => pushRow("IN",  inDist.get(id),  id));
    outOnly.forEach((id) => pushRow("OUT", outDist.get(id), id));
    both.forEach((id) => {
      const di = inDist.get(id);
      const d0 = outDist.get(id);
      if (placeToIn) pushRow("IN",  Number.isFinite(di as number) ? di : d0, id);
      else           pushRow("OUT", Number.isFinite(d0 as number) ? d0 : di, id);
    });

    const byOrigX = (a: string, b: string) => {
      const ax = origPos.get(a)?.x ?? 0; const bx = origPos.get(b)?.x ?? 0;
      if (ax !== bx) return ax - bx; return a.localeCompare(b);
    };

    const pos: Record<string, { x: number; y: number }> = {};
    pos[root] = { x: cx, y: cyy };

    const placeRow = (arr: string[], y: number) => {
      const n = arr.length; if (!n || !Number.isFinite(y)) return;
      const SAFE_W = 120;
      const PAD_RATIO = 0.06;      // 라벨폭 기반 가산 비율(낮을수록 촘촘)
      const MIN_GAP  = 10;         // 노드 간 최소 간격
      const GAP_CAP  = 48;         // 가산 간격 상한
      const COMPRESS = 0.55;       // 행 전체 간격 압축(0.55 = 45% 압축)

      // 1) HTML 라벨 기준 폭(모델좌표) 측정
      const widths = arr.map((id) => {
        const w = measureNodeWidthModel(id);           // ✅ HTML 라벨 기준
        return Number.isFinite(w) ? Math.max(w, SAFE_W) : SAFE_W;
      });

      // 2) 인접 간격: 상한/최소 + 행 전체 압축 → 가로 겹침 방지
      let gaps: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const wL = Math.min(widths[i],     SAFE_W + GAP_CAP * 3);
        const wR = Math.min(widths[i + 1], SAFE_W + GAP_CAP * 3);
        const extra = Math.min(Math.round(Math.min(wL, wR) * PAD_RATIO), GAP_CAP);
        gaps.push(Math.max(MIN_GAP, BASE_GAP + extra));
      }
      gaps = gaps.map(g => Math.max(MIN_GAP, Math.floor(g * COMPRESS)));

      // 3) 총 너비/커서
      const sumW = widths.reduce((a, b) => a + (Number.isFinite(b) ? b : SAFE_W), 0);
      const sumG = gaps.reduce((a, b) => a + b, 0);
      const total = sumW + sumG;

      let cursor = cx - total / 2;
      const safeY = Number.isFinite(y) ? y : cyy;

      // 4) 배치
      for (let i = 0; i < n; i++) {
        const w = Number.isFinite(widths[i]) ? widths[i] : SAFE_W;
        const xCenter = cursor + w / 2;
        pos[arr[i]] = {
          x: Number.isFinite(xCenter) ? xCenter : (cx + i * (SAFE_W + BASE_GAP)),
          y: safeY
        };
        cursor += w + (i < n - 1 ? gaps[i] : 0);
      }
    };

    const rowKeys = [...rows.keys()].sort((a, b) => {
      const da = Number(a.split(":")[1]);
      const db = Number(b.split(":")[1]);
      if (da !== db) return da - db;
      const dirA = a.startsWith("IN") ? 0 : 1;
      const dirB = b.startsWith("IN") ? 0 : 1;
      return dirA - dirB;
    });

    rowKeys.forEach((key) => {
      const arr = rows.get(key)!; if (!arr || arr.length === 0) return;
      arr.sort(byOrigX);
      const y = yOf.get(key);
      if (typeof y === "number") placeRow(arr, y);
    });

    const valid = nodes.filter((n) => {
      const p = pos[n.id()]; return p && Number.isFinite(p.x) && Number.isFinite(p.y);
    });
    if (valid.length === 0) return;

    valid.layout({
      name: "preset",
      positions: (n: any) => pos[n.id()],
      fit: false,
      animate: false,
      animationDuration: 350,
    } as any).run();
  }

  function restorePositionsIfAny() {
    const cy = cyRef.current; if (!cy) return;
    if (savedPositionsRef.current.size === 0) return;
    cy.batch(() => {
      savedPositionsRef.current.forEach((pos, id) => {
        const n = cy.getElementById(id);
        if (n && n.length) n.position(pos);
      });
    });
    savedPositionsRef.current.clear();
  }

  // Reactively re-apply whenever k or selected node changes
  useEffect(() => {
    if (!selectedId) { clearHL(); lastHLRef.current = { nid: null, k }; return; }
    updateHL(selectedId);
    if (k > 0) clusterSelectionWithNeighborsQueued(k);
    else restorePositionsIfAny();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, selectedId]);

  // -------------------- Panel list --------------------
  const filtered = useMemo(() => {
    const nq = norm(panelFilter);
    if (!nq) return Array.from(new Set(allLabelsSorted));
    return Array.from(new Set(allLabelsSorted)).filter((lab) => {
      const dl = norm(toDisplay(lab));
      const rl = norm(lab);
      const il = norm(toId(lab));
      return dl.includes(nq) || rl.includes(nq) || il.includes(nq);
    });
  }, [panelFilter, allLabelsSorted]);


  const getById = (id: string) => cyRef.current?.getElementById(id);
  const anchorForLabel = (lab: string) => {
    const id = toId(lab); const direct = getById(id); if (direct && direct.length) return direct;
    const eq = eqMapById.get(id) ?? []; for (const each of eq) { const n = getById(toId(each)); if (n && n.length) return n; }
    return null;
  };

  // -------------------- Floating EQ --------------------
  type EqUI = { showBtn: boolean; showPop: boolean; x: number | null; y: number | null; list: string[] };
  const [eqUI, setEqUI] = useState<EqUI>({ showBtn: false, showPop: false, x: null, y: null, list: [] });

  // NodeSingular/Collection 모두 허용
    const positionEqButton = (nodeLike: NodeLike) => {
      const cy = cyRef.current as cytoscape.Core | null;
      if (!cy || !containerRef.current) return;

      const node = asNode(nodeLike);
      if (!node || !node.length) return;

      const box = node.renderedBoundingBox();
      const rect = containerRef.current.getBoundingClientRect();
      const x = rect.left + box.x2 + 24;
      const y = rect.top + (box.y1 + box.y2) / 2 - 12;

      // 자기 자신 제외한 equivalent 목록
      const labs = (eqMapById.get(node.id()) ?? []).filter(lab => toId(lab) !== node.id());

      setEqUI(s => ({ ...s, x, y, list: labs, showBtn: true, showPop: false }));
    };


  const showEqBtn = () => setEqUI((s) => ({ ...s, showBtn: true, showPop: false }));
  const hideEqAll = () => setEqUI({ showBtn: false, showPop: false, x: null, y: null, list: [] });

  const rafIdRef = useRef<number | null>(null);
  const queuedRef = useRef(false);
  const queueReposition = (calc: () => void) => {
    if (queuedRef.current) return; queuedRef.current = true;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => { queuedRef.current = false; calc(); });
  };

  // -------------------- Render --------------------
  return (
    <div className="relative h-screen overflow-hidden">
      {/* Header */}
      <HeaderBar
        title="Graph Parameter Hierarchy"
        onReset={() => {
          const cy = cyRef.current; if (!cy) return;
          clearHL();
          cy.nodes().removeClass("SEL");
          setSelectedId(null);
          hideEqAll();
          restorePositionsIfAny();
          const z = cy.zoom();
          cy.center(cy.nodes());
          cy.zoom(z);
          lastHLRef.current = { nid: null, k: kRef.current };
        }}
        
        onToggleOptions={() => setShowOptions((v) => !v)}
        onTogglePanel={() => setPanelCollapsed((v) => !v)}
        panelCollapsed={panelCollapsed}
        onOptionsAnchor={(rect) => setOptAnchor(rect)}
      />

      {showOptions && (
        <div
          className="fixed z-50 w-64 rounded-xl border bg-white p-3 shadow-lg"
          style={{ left: optAnchor ? optAnchor.left : 24, top: optAnchor ? optAnchor.bottom + 8 : 64 }}
        >
          <div className="mb-2 text-sm font-semibold text-gray-800">Options</div>
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium text-gray-500">K-neighbor</div>
            <div className="flex gap-2">
              {[0, 1, 2].map((kk) => (
                <button
                  key={kk}
                  onClick={() => setK(kk as 0 | 1 | 2)}
                  className={`rounded-md border px-2 py-1 text-sm ${k === kk ? "bg-blue-600 text-white" : "bg-white"}`}
                >
                  {kk === 0 ? "OFF" : `k=${kk}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* LEFT NAV */}
      <nav className={`fixed left-0 top-14 z-20 h-[calc(100vh-56px)] w-72 border-r bg-[#f6f7f9] ${panelCollapsed ? "hidden" : ""}`}>
        <div className="h-14 px-4 flex items-center gap-2 border-b bg-white/80 backdrop-blur">
          <div className="h-6 w-6 rounded-md bg-sky-500" />
          <div className="text-[13px] font-semibold text-slate-800">All parameters</div>
        </div>

        <div className="px-3 pt-3">
          <input
            value={panelFilter}
            onChange={(e) => setPanelFilter(e.target.value)}
            className="w-full text-sm outline-none px-3 py-2 rounded-xl border bg-white"
            placeholder="search parameters"
          />
        </div>

        <div className="mt-3 h-[calc(100vh-56px-56px)] overflow-auto px-2 pb-4">
          <div className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500">All</div>
          <ul className="space-y-1">
            {filtered.map((lab) => {
              const id = toId(lab); const active = selectedId === id;
              return (
                <li key={lab}>
                  <button
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-slate-700 hover:bg-white border border-transparent ${active ? "bg-white border-slate-200 shadow-sm" : ""}`}
                    onClick={() => {
                      const n = anchorForLabel(lab); if (!n || !n.length) return;
                      setSelectedId(n.id());
                      updateHL(n.id());
                      const cy = cyRef.current!; cy.center(n);
                      positionEqButton(n); showEqBtn();
                      if (kRef.current > 0) clusterSelectionWithNeighborsQueued(kRef.current as 1 | 2);
                    }}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span className="truncate">{toDisplay(lab)}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-4 h-px bg-slate-200 mx-2" />

          <div className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <span>Equivalent (↔)</span>
            <button
              className="ml-auto px-2 py-1 text-[11px] rounded-md bg-white border hover:bg-slate-100"
              onClick={() => setEqSortAsc((v) => !v)}
            >
              Sort {eqSortAsc ? "A→Z" : "Z→A"}
            </button>
          </div>
          <div className="px-2">
            {!selectedId ? (
              <div className="text-slate-500 text-[13px] px-1">Select a node.</div>
            ) : (
              <ul className="space-y-1">
                {(((eqMapById.get(selectedId) ?? [])
                  .filter((lab) => toId(lab) !== selectedId)
                  .slice())
                  .sort((a, b) =>
                    eqSortAsc
                      ? toDisplay(a).localeCompare(toDisplay(b))
                      : toDisplay(b).localeCompare(toDisplay(a))
                  )).map((lab) => {
                    const id = toId(lab); const active = selectedId === id;
                    return (
                      <li key={lab}>
                        <button
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-slate-700 hover:bg-white border border-transparent ${active ? "bg-white border-slate-200 shadow-sm" : ""}`}
                          onClick={() => {
                            const n = anchorForLabel(lab); if (!n || !n.length) return;
                            setSelectedId(n.id());
                            updateHL(n.id());
                            const cy = cyRef.current!; cy.center(n);
                            positionEqButton(n); showEqBtn();
                            if (kRef.current > 0) clusterSelectionWithNeighbors(kRef.current as 1 | 2);
                          }}
                        >
                          <span className="text-slate-400">
                            <svg width="14" height="14" viewBox="0 0 24 24">
                              <path d="M10.6 13.4a2 2 0 0 0 2.8 0l3.2-3.2a2 2 0 1 0-2.8-2.8l-1.1 1.1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M13.4 10.6a2 2 0 0 0-2.8 0L7.4 13.8a2 2 0 1 0 2.8 2.8l1.1-1.1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="truncate">{toDisplay(lab)}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <main
        ref={mainRef}
        className={`${panelCollapsed ? "ml-0" : "ml-72"} h-[calc(100vh-56px)] relative top-14 transition-[margin] duration-200`}
      >
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ border: "none", outline: "none", background: "transparent", boxShadow: "none" }}
        />
      </main>

      {/* === Floating EQ button === */}
      <div
        className="fixed z-30"
        style={{
          left: eqUI.x ?? -9999,
          top: eqUI.y ?? -9999,
          display: eqUI.showBtn && eqUI.x !== null && eqUI.y !== null ? "block" : "none",
        }}
        onClick={(e) => { e.stopPropagation(); setEqUI((s) => ({ ...s, showPop: !s.showPop })); }}
      >
        <button className="px-2.5 py-1.5 text-[12px] rounded-xl border bg-white shadow-sm hover:bg-slate-50">
          Equivalent parameters (↔)
        </button>
      </div>

      {/* === Popover === */}
      <div
        className="fixed z-40"
        style={{
          left: eqUI.x ?? -9999,
          top: eqUI.y !== null ? eqUI.y + 28 : -9999,
          display: eqUI.showPop && eqUI.x !== null && eqUI.y !== null ? "block" : "none",
          minWidth: 220,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border bg-white shadow-xl p-3">
          <div className="text-[12px] font-semibold text-slate-800 mb-2">Equivalent parameters (↔)</div>
          <ul className="max-h-64 overflow-auto text-[13px]">
            {eqUI.list.length === 0 ? (
              <li className="text-slate-500 px-2 py-1">(none)</li>
            ) : (
              [...eqUI.list].sort((a, b) => a.localeCompare(b)).map((lab) => (
                <li key={lab}>
                  <button
                    className="w-full text-left px-2 py-1 rounded hover:bg-slate-50"
                    onClick={() => {
                      const cy = cyRef.current!; const n = cy.getElementById(toId(lab)); if (!n || !n.length) return;
                      setSelectedId(n.id());
                      updateHL(n.id());
                      positionEqButton(n as any);
                      setEqUI((s) => ({ ...s, showPop: false, showBtn: true }));
                      if (kRef.current > 0) clusterSelectionWithNeighbors(kRef.current as 1 | 2);
                    }}
                  >
                    {toDisplay(lab)}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
