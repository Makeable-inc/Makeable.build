export function RetailerBrand({ retailer }: { retailer: "amazon" | "aliexpress" }) {
  if (retailer === "amazon") {
    return (
      <span className="mk-retailer-wordmark mk-retailer-wordmark-amazon" aria-label="Amazon">
        <span aria-hidden="true">amazon</span>
        <svg viewBox="0 0 54 9" aria-hidden="true" focusable="false">
          <path d="M3 2.2c12.2 5.1 30.4 5.4 43.8.2" />
          <path d="m43.4 1.1 4.8.8-2.2 4.1" />
        </svg>
      </span>
    );
  }
  return (
    <span className="mk-retailer-wordmark mk-retailer-wordmark-aliexpress" aria-label="AliExpress">
      <svg viewBox="0 0 22 22" aria-hidden="true" focusable="false">
        <path d="M4.2 7.7h13.6l-1 10.2H5.2z" />
        <path d="M7.5 8V6.1a3.5 3.5 0 0 1 7 0V8" />
        <path d="M8 12.8h6M9.1 15h3.8" />
      </svg>
      <span aria-hidden="true">AliExpress</span>
    </span>
  );
}
