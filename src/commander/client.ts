import {
  createWire,
  RPC,
  type RPCCall,
  type RPCResponse,
} from "@ezenki/deploy-commander-installer-interface";

async function handleIncomingCall(call: RPCCall): Promise<RPCResponse> {
  return {
    ok: false,
    error: {
      message: `Unsupported request: ${call.request}`,
    },
  };
}

export function createCommanderClient() {
  const wire = createWire(handleIncomingCall);
  const caller = RPC.SetupRPCCaller(wire);
  let disposed = false;

  return {
    caller,
    dispose() {
      if (disposed) return;
      disposed = true;
      wire.end();
    },
  };
}
