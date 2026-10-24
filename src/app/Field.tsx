/** Fixed colour field (gradient + three blurred blobs), rendered once behind everything. */
export function Field() {
  return (
    <div className="field" aria-hidden="true">
      <span className="blob blob-1" data-par=".18" />
      <span className="blob blob-2" data-par="-.12" />
      <span className="blob blob-3" data-par=".08" />
    </div>
  );
}
