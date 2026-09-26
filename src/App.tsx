import type { RPCCaller } from "@ezenki/deploy-commander-installer-interface";

export default function App({ caller }: { caller: RPCCaller }) {
  return (
    <main data-commander-ready={Boolean(caller)}>
      <h1>Docker credentials</h1>
    </main>
  );
}
