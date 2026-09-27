import * as React from 'react';
/**
 * Content container with optional eyebrow + title.
 * @startingPoint section="Display" subtitle="Content cards" viewport="700x300"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement>{
  /** content = 12px radius, 16px padding: answers, tables, commands */
  variant?:'default'|'raised'|'outline'|'content';
  interactive?:boolean;
  /** Tracked-out uppercase label inside the card. Never above a page title: the tagline on Search is the only line there. */
  eyebrow?:string;
  title?:React.ReactNode;
  children?:React.ReactNode;
}
export declare function Card(props:CardProps):JSX.Element;