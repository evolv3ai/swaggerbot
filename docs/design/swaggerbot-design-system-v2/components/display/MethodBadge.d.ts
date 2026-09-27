export interface MethodBadgeProps{
  method:'GET'|'POST';
  /** sm beside a nav link; md in a route heading */
  size?:'sm'|'md';
  className?:string;
}
export declare function MethodBadge(props:MethodBadgeProps):JSX.Element;
