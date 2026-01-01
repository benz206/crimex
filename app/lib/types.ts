export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type IncidentProperties = {
  OBJECTID: number;
  DATE?: number;
  CITY?: string;
  DESCRIPTION?: string;
  CASE_NO?: string | number;
  [k: string]: unknown;
};

export type IncidentFeature = GeoJSON.Feature<GeoJSON.Point, IncidentProperties>;

export type IncidentFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  IncidentProperties
>;

export type IncidentFilters = {
  startMs?: number;
  endMs?: number;
  city?: string[];
  description?: string[];
  hideRoadTests?: boolean;
};

export type HeatmapSettings = {
  radius0: number;
  radius12: number;
  intensity0: number;
  intensity12: number;
  opacity: number;
  outlineOpacity: number;
};


