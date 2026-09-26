export interface AnswerBadgeProps{
  /** One of SwaggerBot's five Lookup answers, sure → not found */
  answer:'resolved'|'unconfirmed'|'ambiguous'|'no-spec'|'unknown';
  /** Use the short labels (Unconf., Ambig.) */
  short?:boolean;
  className?:string;
}
export declare function AnswerBadge(props:AnswerBadgeProps):JSX.Element;