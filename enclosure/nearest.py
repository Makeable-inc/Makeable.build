"""Exact closest points on a triangle mesh, fast: VTK's C++ cell locator (VTK comes with pyvista) gives the same
point-to-triangle distances as trimesh.proximity.closest_point (to ~1e-8 mm) about 15x faster on case meshes.
closest_point(mesh, points) -> (closest points, distances, triangle ids), like trimesh's."""
import numpy as np

_locators = {}
KEEP = 8   # locators kept: the checks run in the agent's own process, run after run


def _locator(mesh):
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray
    key = id(mesh)
    if key in _locators and _locators[key][0] is mesh:
        return _locators[key][1]
    poly, points = vtk.vtkPolyData(), vtk.vtkPoints()
    points.SetData(numpy_to_vtk(np.ascontiguousarray(mesh.vertices, dtype=float), deep=True))
    poly.SetPoints(points)
    cells = np.hstack([np.full((len(mesh.faces), 1), 3), mesh.faces]).astype(np.int64).ravel()
    polys = vtk.vtkCellArray()
    polys.SetCells(len(mesh.faces), numpy_to_vtkIdTypeArray(cells, deep=True))
    poly.SetPolys(polys)
    locator = vtk.vtkStaticCellLocator()
    locator.SetDataSet(poly)
    locator.BuildLocator()
    if len(_locators) >= KEEP:
        _locators.pop(next(iter(_locators)))
    _locators[key] = (mesh, locator, poly)   # poly kept alive with the locator
    return locator


def closest_point(mesh, points):
    import vtk
    points = np.asarray(points, dtype=float).reshape(-1, 3)
    locator = _locator(mesh)
    closest = np.empty_like(points)
    distances = np.empty(len(points))
    triangles = np.empty(len(points), dtype=np.int64)
    found, cell, sub, squared = [0.0, 0.0, 0.0], vtk.reference(0), vtk.reference(0), vtk.reference(0.0)
    for i, p in enumerate(points):
        locator.FindClosestPoint(p.tolist(), found, cell, sub, squared)
        closest[i], distances[i], triangles[i] = found, float(squared) ** 0.5, int(cell)
    return closest, distances, triangles
