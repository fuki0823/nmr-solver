"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Ketcher } from "ketcher-core";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import "ketcher-react/dist/index.css";

interface StructureEditorProps {
  onReady: (ketcher: Ketcher) => void;
}

// Editor(ketcher-react)は errorHandler/onInit が親の再レンダリングごとに
// 新しい関数として渡されると内部でKetcherを再構築してしまい、描いた構造が
// 消えてしまう。そのため useCallback で参照を固定し、コンポーネント自体も
// memo化して不要な再レンダリングを避ける。
function StructureEditor({ onReady }: StructureEditorProps) {
  // レンダー中に ref を読み書きすると React の purity ルールに反するため、
  // 一度だけ生成すればよいインスタンスは useState の遅延初期化で作る。
  const [structServiceProvider] = useState(
    () => new StandaloneStructServiceProvider(),
  );

  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const handleInit = useCallback((ketcher: Ketcher) => {
    onReadyRef.current(ketcher);
  }, []);

  const handleError = useCallback((message: string) => {
    console.error("Ketcher error:", message);
  }, []);

  return (
    <div className="h-[480px] w-full overflow-hidden rounded-lg border border-stone-300">
      <Editor
        staticResourcesUrl=""
        structServiceProvider={structServiceProvider}
        errorHandler={handleError}
        disableMacromoleculesEditor
        onInit={handleInit}
      />
    </div>
  );
}

export default memo(StructureEditor);
