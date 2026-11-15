(() => {
  const els = [...document.querySelectorAll("input,select,textarea")];
  return {
    count: els.length,
    bad: els.filter((e) => !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")).length,
    sample: els.slice(0, 3).map((e) => e.getAttribute("aria-label")),
  };
})()
