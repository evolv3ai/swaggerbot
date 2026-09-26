import * as React from 'react';
/**
 * Content container with optional eyebrow + title.
 * @startingPoint section="Display" subtitle="Content cards" viewport="700x300"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement>{
  variant?:'default'|'raised'|'outline';
  interactive?:boolean;
  /** Tracked-out uppercase label, echoing the "BETTER THAN SPECS" tagline */
  eyebrow?:string;
  title?:React.ReactNode;
  children?:React.ReactNode;
}
export declare function Card(props:CardProps):JSX.Element;