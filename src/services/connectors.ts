export type ConnectorContext={input:Record<string,unknown>;config:Record<string,unknown>};
export type ConnectorResult={data:Record<string,unknown>};
export type Connector={type:string;execute:(ctx:ConnectorContext)=>Promise<ConnectorResult>|ConnectorResult};
const setFields:Connector={type:"set_fields",execute:({input,config})=>({data:{...input,...config}})};
const passthrough:Connector={type:"passthrough",execute:({input})=>({data:{...input}})};
const registry=new Map<string,Connector>([["set_fields",setFields],["passthrough",passthrough]]);
export function registerConnector(connector:Connector){if(!connector?.type?.trim())throw new Error("connector type is required");registry.set(connector.type.trim(),connector);}
export function getConnector(type:string){return registry.get(type.trim());}
export function listConnectors(){return [...registry.keys()].sort();}
