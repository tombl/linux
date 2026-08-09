// SPDX-License-Identifier: MIT

export {
  attach_guest,
  createNetwork,
  type GuestNetwork,
  type Network,
  type NetworkAddress,
  type NetworkOptions,
  type TcpConnection,
  type TcpConnectOptions,
  type TcpSession,
  type UdpConnection,
  type UdpConnectOptions,
} from "./gateway.ts";

export {
  connectTcpOverWebSocket,
  resolveDnsOverProxy,
  wsTcpProxyNetwork,
  type WsTcpProxyOptions,
} from "./ws-tcp.ts";
