// Provincias de Cuba con sus coordenadas centrales aproximadas
// para centrar el mapa al elegir provincia
export const PROVINCIAS = [
  { name: 'La Habana', lat: 23.05, lng: -82.37, zoom: 11 },
  { name: 'Matanzas', lat: 22.90, lng: -81.15, zoom: 10 },
  { name: 'Pinar del Río', lat: 22.42, lng: -83.70, zoom: 9 },
  { name: 'Artemisa', lat: 22.82, lng: -82.76, zoom: 10 },
  { name: 'Mayabeque', lat: 22.82, lng: -82.05, zoom: 10 },
  { name: 'Villa Clara', lat: 22.40, lng: -80.00, zoom: 9 },
  { name: 'Cienfuegos', lat: 22.15, lng: -80.45, zoom: 10 },
  { name: 'Sancti Spíritus', lat: 21.93, lng: -79.44, zoom: 9 },
  { name: 'Ciego de Ávila', lat: 21.85, lng: -78.76, zoom: 9 },
  { name: 'Camagüey', lat: 21.39, lng: -77.91, zoom: 9 },
  { name: 'Las Tunas', lat: 20.96, lng: -76.95, zoom: 9 },
  { name: 'Holguín', lat: 20.89, lng: -76.26, zoom: 9 },
  { name: 'Granma', lat: 20.38, lng: -76.64, zoom: 9 },
  { name: 'Santiago de Cuba', lat: 20.02, lng: -75.83, zoom: 10 },
  { name: 'Guantánamo', lat: 20.14, lng: -75.21, zoom: 9 },
  { name: 'Isla de la Juventud', lat: 21.60, lng: -82.95, zoom: 9 }
]

export const CUBA_CENTER = { lat: 21.8, lng: -79.9, zoom: 7 }

export function getProvincia(name) {
  return PROVINCIAS.find((p) => p.name === name) || null
}
