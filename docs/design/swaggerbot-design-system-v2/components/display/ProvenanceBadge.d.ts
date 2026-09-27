import * as React from 'react';
export interface ProvenanceBadgeProps{
  /** A Spec's Provenance tier, strongest first */
  provenance:'Official'|'Endorsed'|'Mirror'|'Community';
  /** Adds "Provenance: " for screen readers, where the badge stands alone (default true) */
  label?:boolean;
  className?:string;
}
export declare function ProvenanceBadge(props:ProvenanceBadgeProps):JSX.Element;
