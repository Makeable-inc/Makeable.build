"use client";
import { useEffect, useRef } from "react";
export function AvailabilityNotice({title,onClose}:{title:string;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";d?.showModal();return()=>{d?.close();document.body.style.overflow=overflow;};},[]);
  return <dialog ref={ref} className="availability-notice" aria-labelledby="availability-title" onCancel={onClose}><button className="availability-close" aria-label="Close availability" onClick={onClose}>×</button><span className="support-eyebrow">IN DEVELOPMENT</span><h2 id="availability-title">{title}</h2><p>This project isn’t available to order yet. You can explore the available Ember pre-order or describe an idea in the experimental builder.</p><a className="support-primary" href="#make" onClick={onClose}>Explore the idea builder</a><button className="availability-secondary" onClick={onClose}>Continue browsing</button></dialog>;
}
