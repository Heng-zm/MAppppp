'use client';

// ==========================================
// 1. IMPORTS
// ==========================================
import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import { Kantumruy_Pro } from 'next/font/google'; 
import 'mapbox-gl/dist/mapbox-gl.css';

// UI Components
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";

// Icons
import { 
  X, MapPin, Navigation, LocateFixed, 
  Volume2, VolumeX, Compass, Loader2, AlertTriangle, 
  Fuel, Utensils, Coffee, Search,
  Layers, Zap, CornerUpLeft, CornerUpRight, ArrowUp,
  Sun, Cloud, CloudRain, CloudLightning, Snowflake, Wind,
  ArrowRight, Clock, History, Navigation as NavIcon,
  Crosshair, Banknote, GraduationCap,
  ChevronDown, ChevronUp, Trash2,
  Phone, Globe, Satellite, Map as MapIcon,
  CarFront, ExternalLink
} from 'lucide-react';

// ==========================================
// 2. CONFIG & HELPERS
// ==========================================

const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'], 
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Environment Variables
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const WEATHER_API_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
const GEOAPIFY_API_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const DEFAULT_CENTER: [number, number] = [104.9282, 11.5564]; // Phnom Penh
const DEFAULT_ZOOM = 15;
const WEATHER_REFRESH_RATE = 15 * 60 * 1000; 
const REROUTE_THRESHOLD_METERS = 35; 
const GPS_NOISE_THRESHOLD = 0.00002; // Approx 2 meters. Ignore jumps smaller than this.

const STYLES = {
  DARK: 'mapbox://styles/mapbox/dark-v11',
  LIGHT: 'mapbox://styles/mapbox/streets-v12',
  SATELLITE: 'mapbox://styles/mapbox/satellite-streets-v12'
};

// --- KHMER SEARCH OPTIMIZATION ---
const KHMER_SEARCH_ALIASES: Record<string, string> = {
    'ហាងកាហ្វេ': 'coffee shop', 'កាហ្វេ': 'coffee', 'ហាងបាយ': 'restaurant',
    'អាហារ': 'food', 'ភោជនីយដ្ឋាន': 'restaurant', 'គុយទាវ': 'noodle',
    'ធនាគារ': 'bank', 'អេធីអឹម': 'atm', 'លុយ': 'financial',
    'ពេទ្យ': 'hospital', 'មន្ទីរពេទ្យ': 'hospital', 'គ្លីនិក': 'clinic', 'ឱសថស្ថាន': 'pharmacy',
    'សាំង': 'gas station', 'ប្រេង': 'gas station', 'ស្ថានីយ៍ប្រេង': 'gas station',
    'ការាស': 'garage', 'ផ្ញើឡាន': 'parking',
    'សាលា': 'school', 'សកលវិទ្យាល័យ': 'university', 'វត្ត': 'pagoda',
    'ផ្សារ': 'market', 'ផ្សារទំនើប': 'mall', 'ម៉ាត': 'convenience store',
    'សណ្ឋាគារ': 'hotel', 'ផ្ទះសំណាក់': 'guesthouse', 'បុរី': 'borey',
};

const isCoordinate = (query: string) => {
    const coordRegex = /^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/;
    return coordRegex.test(query.trim());
};

// --- GEOMETRY UTILS ---

function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

function getMinDistanceToRoute(userLat: number, userLng: number, routeCoords: number[][]) {
    let minDistance = Infinity;
    for (const coord of routeCoords) {
        const dist = getDistanceFromLatLonInMeters(userLat, userLng, coord[1], coord[0]);
        if (dist < minDistance) minDistance = dist;
    }
    return minDistance;
}

const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;

const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} គ.ម` : `${d.toFixed(0)} ម៉ែត្រ`;

const formatDuration = (s: number) => { 
    const m = Math.round(s / 60); 
    return m < 60 ? `${m} នាទី` : `${Math.floor(m / 60)}ម៉ោង ${m % 60}នាទី`; 
};

const simplifyGeometry = (coordinates: number[][]) => {
    if (!coordinates || coordinates.length === 0) return "";
    const simplified = coordinates.filter((_, i) => i % 5 === 0 || i === coordinates.length - 1);
    const str = simplified.map(c => `${c[0]},${c[1]}`).join(',');
    return `line_string:${str}`;
};

const HighlightMatch = ({ text, match }: { text: string, match: string }) => {
    if (!match || !text) return <span>{text}</span>;
    const parts = text.split(new RegExp(`(${match})`, 'gi'));
    return (
        <span>
            {parts.map((part, i) => 
                part.toLowerCase() === match.toLowerCase() ? <span key={i} className="text-indigo-400 font-bold">{part}</span> : part
            )}
        </span>
    );
};

type SearchResult = { lng: number, lat: number, name: string, type: string, address: string };

const mapFeaturesToResults = (features: any[]): SearchResult[] => {
    return features.map((f: any) => {
        const name = f.text_km || f.text_en || f.text;
        let rawAddress = (f.properties?.address || f.place_name_km || f.place_name || "").toString();
        if (rawAddress.startsWith(name)) {
            rawAddress = rawAddress.substring(name.length).replace(/^,\s*/, "").trim();
        }
        const cleanAddress = rawAddress
            .replace(", Cambodia", "")
            .replace(", កម្ពុជា", "")
            .replace(/, Phnom Penh/g, "") 
            .trim()
            .replace(/^,\s*/, ""); 

        return {
            lng: f.center[0],
            lat: f.center[1],
            name: name, 
            address: cleanAddress || "ទីតាំងផែនទី",
            type: f.properties?.category || f.place_type[0] || "general"
        }
    });
};

const getWeatherIcon = (condition: string) => {
    const c = condition.toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('ភ្លៀង')) return <CloudRain className="h-5 w-5 text-blue-400" />;
    if (c.includes('thunder') || c.includes('រន្ទះ')) return <CloudLightning className="h-5 w-5 text-yellow-400" />;
    if (c.includes('snow')) return <Snowflake className="h-5 w-5 text-white" />;
    if (c.includes('cloud') || c.includes('ពពក')) return <Cloud className="h-5 w-5 text-gray-400" />;
    if (c.includes('clear') || c.includes('sun') || c.includes('ស្រឡះ')) return <Sun className="h-5 w-5 text-orange-400" />;
    return <Wind className="h-5 w-5 text-zinc-400" />;
};

const ManeuverIcon = memo(({ instruction }: { instruction: string }) => {
    const text = instruction.toLowerCase();
    const iconClass = "h-8 w-8 text-white";
    if (text.includes('left') || text.includes('ឆ្វេង')) return <CornerUpLeft className={iconClass} />;
    if (text.includes('right') || text.includes('ស្តាំ')) return <CornerUpRight className={iconClass} />;
    if (text.includes('straight') || text.includes('continue') || text.includes('ត្រង់')) return <ArrowUp className={iconClass} />;
    if (text.includes('uturn') || text.includes('ត្រឡប់')) return <Zap className={iconClass} />;
    return <NavIcon className={iconClass} />;
});
ManeuverIcon.displayName = 'ManeuverIcon';

type WeatherData = { temp: number; condition: string; description: string };
type RouteDetails = { distance: number; duration: number; instruction: string; arrivalTime: string; };

// ==========================================
// 3. MAIN COMPONENT
// ==========================================
export default function MapExplorerPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const wakeLock = useRef<any>(null);
  
  const destinationMarker = useRef<Marker | null>(null);
  const puckMarker = useRef<Marker | null>(null);
  const puckElement = useRef<HTMLDivElement | null>(null);
  const searchMarkers = useRef<Marker[]>([]);
  const routeGeoJSON = useRef<any>(null); 
  
  const userLocation = useRef<[number, number] | null>(null);
  const activeDestination = useRef<[number, number] | null>(null); 
  const watchId = useRef<number | null>(null); 
  
  const isNavigating = useRef<boolean>(false);
  const isRecalculating = useRef<boolean>(false);
  const userIsInteracting = useRef<boolean>(false); 
  const isMounted = useRef<boolean>(false);
  const showRecenterBtnRef = useRef(false);
  const lastSpokenInstruction = useRef<string>("");
  const lastWeatherFetchTime = useRef<number>(0);
  const addressAbortController = useRef<AbortController | null>(null);

  // --- HYBRID LOCATION SYSTEM REFS ---
  const currentPuckPos = useRef<[number, number]>(DEFAULT_CENTER);
  const targetPuckPos = useRef<[number, number]>(DEFAULT_CENTER);
  const currentHeading = useRef<number>(0);
  const targetHeading = useRef<number>(0);
  const compassHeading = useRef<number>(0); // From DeviceOrientation
  const gpsHeading = useRef<number>(0);     // From Geolocation
  const lastTimestamp = useRef<number>(0);
  const animationFrameId = useRef<number>(0);

  const { toast } = useToast();
  const [locationDetails, setLocationDetails] = useState<{lng: number, lat: number} | null>(null);
  const [addressDetails, setAddressDetails] = useState<any>(null);
  const [richPlaceDetails, setRichPlaceDetails] = useState<any>(null); 
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isFetchingRichDetails, setIsFetchingRichDetails] = useState(false);
  const [isRouting, setIsRouting] = useState(false); 
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isTrafficVisible, setIsTrafficVisible] = useState(true);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [currentStyle, setCurrentStyle] = useState(STYLES.DARK);

  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);

  // Voice Init
  useEffect(() => {
    const updateVoices = () => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) setAvailableVoices(voices);
        }
    };
    if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = updateVoices;
        updateVoices();
    }
    return () => { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMuted || !window.speechSynthesis) return;
    if (window.speechSynthesis.speaking && lastSpokenInstruction.current === text) return;
    window.speechSynthesis.cancel(); 
    
    const utterance = new SpeechSynthesisUtterance(text);
    const preferredVoice = availableVoices.find(v => v.lang.includes('km')) || 
                           availableVoices.find(v => v.name.includes('Google') && v.lang.includes('en')) || 
                           availableVoices.find(v => v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.0; 
    window.speechSynthesis.speak(utterance);
  }, [isMuted, availableVoices]);

  const requestWakeLock = async () => {
    try {
        if ('wakeLock' in navigator) {
            wakeLock.current = await navigator.wakeLock.request('screen');
            wakeLock.current.addEventListener('release', () => console.log('Screen Wake Lock released'));
        }
    } catch (err) { console.error(`${err}`); }
  };

  const releaseWakeLock = async () => {
    if(wakeLock.current) {
        await wakeLock.current.release();
        wakeLock.current = null;
    }
  };

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
      const now = Date.now();
      if (!WEATHER_API_KEY || (now - lastWeatherFetchTime.current < WEATHER_REFRESH_RATE && weather)) return;
      lastWeatherFetchTime.current = now;
      try {
          const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=km&appid=${WEATHER_API_KEY}`);
          if (!res.ok) throw new Error("Weather API Error");
          const data = await res.json();
          if (data.main && data.weather) {
              setWeather({
                  temp: Math.round(data.main.temp),
                  condition: data.weather[0].main,
                  description: data.weather[0].description
              });
          }
      } catch (err) { console.error("Weather error", err); }
  }, [weather]);

  const searchPlaces = async (query: string, center: [number, number], bboxOnly: boolean = false, signal?: AbortSignal) => {
    if (!MAPBOX_TOKEN) return [];
    
    let searchQuery = query.trim();
    const lowerQuery = query.toLowerCase();

    if (isCoordinate(searchQuery)) {
        const [lat, lng] = searchQuery.split(',').map(n => parseFloat(n.trim()));
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=km,en`;
        try {
            const res = await fetch(url, { signal });
            const data = await res.json();
            return mapFeaturesToResults(data.features || []);
        } catch (e) { return []; }
    }

    if (KHMER_SEARCH_ALIASES[searchQuery]) {
        searchQuery = KHMER_SEARCH_ALIASES[searchQuery];
    } else if (lowerQuery.match(/gas|fuel|station|បូមសាំង/i)) searchQuery = "gas station";
    else if (lowerQuery.match(/hospital|clinic|doctor/i)) searchQuery = "hospital";

    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}`;
    url += `&language=km,en&country=kh&limit=10&fuzzyMatch=true&proximity=${center[0]},${center[1]}`;
    url += `&types=poi,address,neighborhood,locality,place`; 

    if (bboxOnly) {
        const radiusKm = 10; 
        const latDelta = radiusKm / 111;
        const lonDelta = radiusKm / (111 * Math.cos(center[1] * (Math.PI / 180)));
        const bbox = `${center[0] - lonDelta},${center[1] - latDelta},${center[0] + lonDelta},${center[1] + latDelta}`;
        url += `&bbox=${bbox}`;
    }

    try {
        const res = await fetch(url, { signal });
        const data = await res.json();
        return mapFeaturesToResults(data.features || []);
    } catch (err: any) {
        if (err.name !== 'AbortError') console.error(err);
        return []; 
    }
  };

  const fetchRoute = useCallback(async (start: [number, number], end: [number, number], isSilentRecalc = false): Promise<boolean> => {
      if (!MAPBOX_TOKEN) return false;
      
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&language=km&overview=full&access_token=${MAPBOX_TOKEN}`;
      
      try {
          const res = await fetch(url);
          const data = await res.json();
          
          if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
              if(!isSilentRecalc) toast({ title: "កំហុស", description: "រកផ្លូវមិនឃើញ ឬមានបញ្ហាបច្ចេកទេស", variant: "destructive" });
              return false;
          }
          const route = data.routes[0];
          routeGeoJSON.current = route.geometry.coordinates;

          if (map.current) drawBlueRoute(map.current, { type: 'Feature', geometry: route.geometry });

          const leg = route.legs[0];
          const instructionText = (leg.steps[0]?.distance < 30 && leg.steps[1]) 
            ? leg.steps[1].maneuver.instruction 
            : (leg.steps[0]?.maneuver.instruction || "ធ្វើដំណើរតាមផ្លូវ");
          
          setRouteDetails({
              distance: route.distance, 
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: new Date(Date.now() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
          return true;
      } catch (error) { 
          console.error("Fetch Error:", error);
          if(!isSilentRecalc) toast({ title: "កំហុសបណ្តាញ", description: "សូមពិនិត្យអ៊ីនធឺណិតរបស់អ្នក", variant: "destructive" });
          return false;
      }
  }, [toast]);

  const fetchRichDetails = async (lat: number, lng: number) => {
    if (!GEOAPIFY_API_KEY) return;
    setIsFetchingRichDetails(true);
    setRichPlaceDetails(null);
    try {
        const url = `https://api.geoapify.com/v2/place-details?lat=${lat}&lon=${lng}&features=details,contact,opening_hours&apiKey=${GEOAPIFY_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            setRichPlaceDetails(data.features[0].properties);
        }
    } catch (e) { console.error("X-Ray Failed", e); } 
    finally { setIsFetchingRichDetails(false); }
  };

  const add3DBuildings = (instance: MapboxMap) => {
    if (instance.getLayer('3d-buildings')) return;
    const layers = instance.getStyle().layers;
    const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
    instance.addLayer({
        'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 14,
        'paint': {
            'fill-extrusion-color': '#2a2a2e',
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
            'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
            'fill-extrusion-opacity': 0.8
        }
    }, labelLayerId);
  };

  const addTrafficLayer = (instance: MapboxMap, visible: boolean) => {
      if (instance.getSource('mapbox-traffic')) {
          if(!visible) instance.setLayoutProperty('traffic', 'visibility', 'none');
          return;
      }
      instance.addSource('mapbox-traffic', { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' });
      instance.addLayer({
          'id': 'traffic', 'type': 'line', 'source': 'mapbox-traffic', 'source-layer': 'traffic', 'minzoom': 12,
          'layout': { 'line-join': 'round', 'line-cap': 'round', 'visibility': visible ? 'visible' : 'none' },
          'paint': {
              'line-width': 2.5,
              'line-color': [
                  'case',
                  ['==', ['get', 'congestion'], 'low'], '#22c55e',
                  ['==', ['get', 'congestion'], 'moderate'], '#eab308',
                  ['==', ['get', 'congestion'], 'heavy'], '#ef4444',
                  ['==', ['get', 'congestion'], 'severe'], '#7f1d1d',
                  'rgba(0,0,0,0)'
              ],
              'line-opacity': 0.8
          }
      });
  };

  const drawBlueRoute = (instance: MapboxMap, geojson: any) => {
      if (!geojson || !geojson.geometry) return;
      
      const layers = instance.getStyle().layers;
      const labelLayerId = layers?.find((layer) => layer.type === 'symbol')?.id;

      if (instance.getSource('custom-route-source')) {
          (instance.getSource('custom-route-source') as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
          instance.addSource('custom-route-source', { type: 'geojson', data: geojson });
          
          instance.addLayer({
              id: 'custom-route-casing', type: 'line', source: 'custom-route-source',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#1557b0', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 7, 18, 20 ], 'line-opacity': 0.9 }
          }, labelLayerId); 
          
          instance.addLayer({
              id: 'custom-route-core', type: 'line', source: 'custom-route-source',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#4285F4', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 4, 18, 14 ], 'line-opacity': 1 }
          }, labelLayerId);
      }
  };

  const removeRouteLayers = (instance: MapboxMap) => {
      if(instance.getLayer('custom-route-core')) instance.removeLayer('custom-route-core');
      if(instance.getLayer('custom-route-casing')) instance.removeLayer('custom-route-casing');
      if(instance.getSource('custom-route-source')) instance.removeSource('custom-route-source');
  };

  const animatePuck = () => {
      if (!puckMarker.current || !isMounted.current || !map.current) return;

      // 1. Position Interpolation
      const newLng = lerp(currentPuckPos.current[0], targetPuckPos.current[0], 0.15);
      const newLat = lerp(currentPuckPos.current[1], targetPuckPos.current[1], 0.15);
      
      // 2. Heading Logic: Hybrid Approach
      // If moving (> 3km/h), use GPS heading. If stopped, try Compass.
      // We calculate "Hybrid Target" first.
      let hybridTargetHeading = targetHeading.current;

      // 3. Heading Interpolation (Shortest Path)
      let diff = hybridTargetHeading - currentHeading.current;
      while (diff < -180) diff += 360;
      while (diff > 180) diff -= 360;
      
      const rotationSpeed = 0.1; 
      const newHeading = currentHeading.current + diff * rotationSpeed;

      // Teleport if too far (avoid sliding across map on init)
      if (Math.abs(targetPuckPos.current[0] - currentPuckPos.current[0]) > 0.01) {
          currentPuckPos.current = targetPuckPos.current;
      } else {
          currentPuckPos.current = [newLng, newLat];
      }
      currentHeading.current = newHeading;

      puckMarker.current.setLngLat(currentPuckPos.current);
      puckMarker.current.setRotation(newHeading);

      if (isNavigating.current && !userIsInteracting.current && !showRecenterBtnRef.current) {
          map.current.easeTo({
              center: currentPuckPos.current,
              bearing: newHeading, 
              duration: 0, 
              padding: { top: 0, bottom: 200, left: 0, right: 0 } 
          });
      }

      animationFrameId.current = requestAnimationFrame(animatePuck);
  };

  const handleStyleChange = (style: string) => {
    if (!map.current || style === currentStyle) return;
    const previousRoute = routeGeoJSON.current;
    
    map.current.once('style.load', () => {
        if (!map.current) return;
        add3DBuildings(map.current);
        addTrafficLayer(map.current, isTrafficVisible); // Preserve traffic state
        if (previousRoute) {
             drawBlueRoute(map.current, { type: 'Feature', geometry: { type: 'LineString', coordinates: previousRoute } });
        }
    });
    map.current.setStyle(style);
    setCurrentStyle(style);
  };

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current, 
      style: currentStyle, 
      center: DEFAULT_CENTER, 
      zoom: DEFAULT_ZOOM, 
      pitch: 45, 
      bearing: 0, 
      attributionControl: false, 
      antialias: true, 
      logoPosition: 'bottom-left', 
      cooperativeGestures: false, 
      scrollZoom: true,
      dragPan: true,
      maxPitch: 85,
    });
    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
      trackUserLocation: false, 
      showUserHeading: false, 
      showUserLocation: false, 
      showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    const el = document.createElement('div');
    el.className = 'navigation-puck'; 
    el.style.display = 'none';
    // Visual Accuracy Halo
    el.innerHTML = `<div class="puck-pulse"></div>`; 
    puckElement.current = el;
    puckMarker.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(DEFAULT_CENTER).addTo(mapInstance);

    // --- COMPASS LISTENER (DeviceOrientation) ---
    const handleOrientation = (event: DeviceOrientationEvent) => {
        if (event.alpha !== null) {
            // Convert Webkit/Android differences if necessary (simplification)
            let compass = event.alpha;
            // iOS webkitCompassHeading is usually more accurate
            if ((event as any).webkitCompassHeading) {
                compass = (event as any).webkitCompassHeading;
            } else {
                compass = 360 - compass; // Android usually runs counter-clockwise alpha
            }
            compassHeading.current = compass;
        }
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('deviceorientation', handleOrientation);
    }

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        geolocate.trigger(); 
        add3DBuildings(mapInstance);
        addTrafficLayer(mapInstance, isTrafficVisible); 
        animatePuck(); 

        // === PRODUCTION-GRADE GPS ENGINE ===
        if ('geolocation' in navigator) {
            watchId.current = navigator.geolocation.watchPosition(
                async (pos) => {
                    if (!isMounted.current) return;
                    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
                    
                    const speedKmh = speed ? Math.round(speed * 3.6) : 0;
                    setCurrentSpeed(prev => (Math.abs(prev - speedKmh) > 2 ? speedKmh : prev)); 
                    
                    // Noise Filter: Don't move if change is tiny (< 2m approx) and speed is low
                    const distMoved = Math.abs(longitude - userLocation.current?.[0] || 0) + Math.abs(latitude - userLocation.current?.[1] || 0);
                    if (userLocation.current && distMoved < GPS_NOISE_THRESHOLD && speedKmh < 3) {
                         // Skip update to prevent jitter
                         return;
                    }

                    userLocation.current = [longitude, latitude];
                    if (puckElement.current) puckElement.current.style.display = 'block';

                    targetPuckPos.current = [longitude, latitude];
                    
                    // --- HYBRID HEADING LOGIC ---
                    if (speedKmh > 3 && heading !== null && heading !== undefined) {
                        // Moving fast? Trust GPS Heading
                        gpsHeading.current = heading;
                        targetHeading.current = heading;
                    } else {
                        // Stopped? Trust Compass (if available) or keep last heading
                        if (compassHeading.current !== 0) {
                             targetHeading.current = compassHeading.current;
                        }
                    }

                    fetchWeather(latitude, longitude);

                    // --- SMART REROUTE LOGIC ---
                    if (isNavigating.current && routeGeoJSON.current && activeDestination.current && !isRecalculating.current) {
                        const distanceToPath = getMinDistanceToRoute(latitude, longitude, routeGeoJSON.current);
                        if (distanceToPath > REROUTE_THRESHOLD_METERS) {
                            console.log(`Off route by ${distanceToPath}m. Recalculating...`);
                            isRecalculating.current = true;
                            toast({ title: "Rerouting...", description: "កំពុងគណនាផ្លូវថ្មី", duration: 2000 });
                            
                            const success = await fetchRoute([longitude, latitude], activeDestination.current, true);
                            isRecalculating.current = false;
                        }
                    }
                },
                (err) => console.warn("GPS Warning:", err),
                { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
            );
        }
    });
    
    // Interaction Handlers
    const handleInteractionStart = () => { 
        if (isNavigating.current) { 
            userIsInteracting.current = true; 
            setShowRecenterBtn(true); 
        } 
    };
    mapInstance.on('touchstart', handleInteractionStart);
    mapInstance.on('dragstart', handleInteractionStart);
    mapInstance.on('pitchstart', handleInteractionStart);
    mapInstance.on('zoomstart', handleInteractionStart);
    mapInstance.on('wheel', handleInteractionStart); 
    
    mapInstance.on('click', (e) => { 
        if(!isNavigating.current) handleMapSelection(e.lngLat); 
    });

    return () => {
      isMounted.current = false;
      cancelAnimationFrame(animationFrameId.current);
      if (typeof window !== 'undefined') window.removeEventListener('deviceorientation', handleOrientation);
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      releaseWakeLock();
      if (destinationMarker.current) destinationMarker.current.remove();
      if (puckMarker.current) puckMarker.current.remove();
      searchMarkers.current.forEach(m => m.remove());
      mapInstance.remove();
      map.current = null;
    }
  }, [fetchWeather, fetchRoute, toast]);

  const clearSearchMarkers = useCallback(() => {
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];
  }, []);

  const handleMapSelection = useCallback((lngLat: { lng: number, lat: number }) => {
      if(!map.current) return;
      
      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      userIsInteracting.current = false;
      
      removeRouteLayers(map.current);
      
      if (destinationMarker.current) destinationMarker.current.remove();
      destinationMarker.current = new Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map.current);
      
      setLocationDetails(lngLat);
      setIsDrawerOpen(true);
      fetchRichDetails(lngLat.lat, lngLat.lng);

      map.current.flyTo({ 
          center: lngLat, 
          zoom: 16, 
          padding: { top: 0, bottom: 250, left: 0, right: 0 }, 
          essential: true, 
          duration: 1500 
      });
  }, []);

  useEffect(() => {
    const handleNavEvent = (e: any) => { if(e.detail) handleMapSelection(e.detail); }
    window.addEventListener('nav-to', handleNavEvent);
    return () => window.removeEventListener('nav-to', handleNavEvent);
  }, [handleMapSelection]);
  
  useEffect(() => {
    if (routeDetails?.instruction && isNavigating.current && lastSpokenInstruction.current !== routeDetails.instruction) {
        speak(routeDetails.instruction);
        lastSpokenInstruction.current = routeDetails.instruction;
    }
  }, [routeDetails, speak]);

  useEffect(() => {
    if (locationDetails) {
      if (addressAbortController.current) addressAbortController.current.abort();
      const controller = new AbortController();
      addressAbortController.current = controller;

      const fetchAddress = async () => {
        setIsFetchingAddress(true);
        const apiKey = GEOAPIFY_API_KEY; 
        
        if (!apiKey) {
            setAddressDetails({ formatted: `${locationDetails.lat.toFixed(5)}, ${locationDetails.lng.toFixed(5)}` });
            setIsFetchingAddress(false);
            return;
        }

        try {
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}&lang=km`, {
              signal: controller.signal
          });
          const data = await response.json();
          if (isMounted.current && !controller.signal.aborted) {
             setAddressDetails((data.features && data.features.length > 0) ? data.features[0].properties : { formatted: "ទីតាំងមិនស្គាល់" });
          }
        } catch (error: any) {
          if (error.name !== 'AbortError' && isMounted.current) {
             setAddressDetails({ formatted: "ទីតាំងមិនស្គាល់" });
          }
        } finally {
          if (isMounted.current && !controller.signal.aborted) setIsFetchingAddress(false);
        }
      };
      fetchAddress();
    }
  }, [locationDetails]);

  const handleStartNavigation = async () => {
    if (!userLocation.current) {
      toast({ title: "កំពុងស្វែងរក GPS...", description: "សូមរង់ចាំបន្តិច" });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    
    setIsRouting(true);
    requestWakeLock(); // Keep screen on
    activeDestination.current = [locationDetails.lng, locationDetails.lat]; 
    const success = await fetchRoute(userLocation.current, [locationDetails.lng, locationDetails.lat]);
    setIsRouting(false);

    if (success) {
        isNavigating.current = true;
        isRecalculating.current = false;
        userIsInteracting.current = false; 
        setShowRecenterBtn(false);
        if (!isMuted) speak("ចាប់ផ្តើមការនាំផ្លូវ");
        
        mapContainer.current?.classList.add('nav-mode');
        setIsDrawerOpen(false);
        
        if(map.current) {
            map.current.flyTo({ 
                center: userLocation.current, 
                zoom: 19, 
                pitch: 70, 
                bearing: map.current.getBearing(), 
                padding: { top: 0, bottom: 200, left: 0, right: 0 },
                essential: true, 
                duration: 2000 
            });
        }
    }
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      userIsInteracting.current = false; 
      setShowRecenterBtn(false);
      showRecenterBtnRef.current = false;
      
      map.current.flyTo({ 
          center: userLocation.current, 
          zoom: 19, 
          pitch: 70, 
          bearing: targetHeading.current, 
          padding: { top: 0, bottom: 200, left: 0, right: 0 },
          duration: 1200 
      });
  }

  const handleUserLocationClick = () => {
    if(!userLocation.current || !map.current) {
        geolocateControl.current?.trigger();
        toast({ title: "ស្វែងរកទីតាំង...", duration: 1000 });
        return;
    }
    map.current.flyTo({
        center: userLocation.current,
        zoom: 16,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 1200
    });
  };

  const clearRoute = useCallback(() => {
    isNavigating.current = false;
    isRecalculating.current = false;
    userIsInteracting.current = false;
    activeDestination.current = null;
    routeGeoJSON.current = null;
    releaseWakeLock(); // Let screen sleep
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    
    mapContainer.current?.classList.remove('nav-mode');
    
    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    if(map.current) removeRouteLayers(map.current);

    clearSearchMarkers();
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    
    if(map.current && userLocation.current) {
        map.current.flyTo({ center: userLocation.current, zoom: 15, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1500 });
    }
  }, [clearSearchMarkers]);

  const plotSearchResults = (results: SearchResult[], query: string) => {
    if (!map.current || results.length === 0) {
        toast({ title: "បរាជ័យ", description: "រកមិនឃើញលទ្ធផលទេ" });
        return;
    }
    const fitBounds = new LngLatBounds();
    if(userLocation.current) fitBounds.extend(userLocation.current);
    
    results.forEach(res => {
        const el = document.createElement('div');
        let bgClass = "bg-indigo-500", iconChar = "P";
        if (query === "gas station" || res.type.includes('fuel')) { bgClass = "bg-orange-500"; iconChar = "⛽"; }
        else if (query === "restaurant" || res.type.includes('catering')) { bgClass = "bg-rose-500"; iconChar = "🍔"; }
        else if (query === "coffee" || res.type.includes('cafe')) { bgClass = "bg-amber-500"; iconChar = "☕"; }
        else if (query === "hospital" || res.type.includes('health')) { bgClass = "bg-red-600"; iconChar = "🏥"; }
        else if (query === "school" || res.type.includes('education')) { bgClass = "bg-blue-500"; iconChar = "🎓"; }
        else if (query === "bank" || res.type.includes('financial')) { bgClass = "bg-emerald-600"; iconChar = "🏦"; }

        el.className = `w-9 h-9 ${bgClass} rounded-full border-[3px] border-zinc-900 shadow-xl cursor-pointer hover:scale-110 transition-transform flex items-center justify-center text-white text-sm font-bold ${kantumruy.className}`;
        el.innerText = iconChar;
        
        const marker = new Marker(el).setLngLat([res.lng, res.lat]).addTo(map.current!);
        el.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            handleMapSelection({ lng: res.lng, lat: res.lat }); 
        });
        searchMarkers.current.push(marker);
        fitBounds.extend([res.lng, res.lat]);
    });
    
    map.current.fitBounds(fitBounds, { padding: 80, maxZoom: 15 });
    toast({ title: "ជោគជ័យ!", description: `រកឃើញ ${results.length} កន្លែង` });
  };

  const handleCategorySearch = async (query: string) => {
    const geoKey = GEOAPIFY_API_KEY;
    const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER);
    clearSearchMarkers();

    if (isNavigating.current && routeGeoJSON.current && geoKey) {
        let category = "commercial"; 
        if (query === "gas station") category = "service.vehicle.fuel";
        if (query === "restaurant") category = "catering.restaurant";
        if (query === "coffee") category = "catering.cafe";
        if (query === "bank") category = "service.financial";
        if (query === "hospital") category = "healthcare";
        if (query === "school") category = "education";

        const geometryStr = simplifyGeometry(routeGeoJSON.current);
        const url = `https://api.geoapify.com/v2/places?categories=${category}&filter=geometry:${geometryStr}&limit=10&apiKey=${geoKey}`;

        try {
            toast({ title: "កំពុងស្វែងរកតាមដងផ្លូវ...", description: "Looking along your route" });
            const res = await fetch(url);
            const data = await res.json();
            
            const results = data.features.map((f: any) => ({
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
                name: f.properties.name || f.properties.address_line1 || "Unknown",
                address: f.properties.address_line2 || "",
                type: query
            }));

            plotSearchResults(results, query);
        } catch (e) {
            console.error("Along route search failed, falling back", e);
            const fallbackResults = await searchPlaces(query, center, true);
            plotSearchResults(fallbackResults, query);
        }

    } else {
        const results = await searchPlaces(query, center, true);
        plotSearchResults(results, query);
    }
  }

  const handleAutocomplete = async (query: string, signal: AbortSignal) => {
    if (!query.trim()) return [];
    const center = map.current ? map.current.getCenter().toArray() as [number, number] : (userLocation.current || DEFAULT_CENTER);
    return await searchPlaces(query, center, false, signal); 
  }

  const toggleTraffic = useCallback(() => {
    if (!map.current || !map.current.getStyle()) return;
    if (!map.current.getLayer('traffic')) {
        addTrafficLayer(map.current, true);
        setIsTrafficVisible(true);
        return;
    }
    const visibility = map.current.getLayoutProperty('traffic', 'visibility');
    const newState = visibility === 'visible' ? 'none' : 'visible';
    map.current.setLayoutProperty('traffic', 'visibility', newState);
    setIsTrafficVisible(newState === 'visible');
  }, []);

  const resetCompass = useCallback(() => {
    if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
  }, []);

  const openGrab = () => {
      if(!locationDetails) return;
      const url = `grab://open?screenType=GRABRIDE&dropOffLatitude=${locationDetails.lat}&dropOffLongitude=${locationDetails.lng}`;
      window.location.href = url;
      setTimeout(() => { window.open('https://www.grab.com/kh/', '_blank'); }, 1500);
  };

  const openPassApp = () => {
     window.location.href = "passapp://";
     setTimeout(() => { window.open('https://passapp-taxi.com/', '_blank'); }, 1500);
  };

  const openGoogleMaps = () => {
      if(!locationDetails) return;
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${locationDetails.lat},${locationDetails.lng}`, '_blank');
  };

  if (!MAPBOX_TOKEN) return <div className={`flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 ${kantumruy.className}`}><Card className="w-full max-w-md bg-zinc-900 border-red-900/50"><CardContent className="flex flex-col items-center gap-4 p-6"><AlertTriangle className="h-8 w-8 text-red-500" /><h2 className="text-xl font-bold">Missing Token</h2><p className="text-center text-zinc-400">Mapbox Access Token is missing.</p></CardContent></Card></div>;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-50 ${kantumruy.className}`}>
        <style jsx global>{`
          .navigation-puck { width: 24px; height: 24px; background-color: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); position: relative; z-index: 10; }
          .navigation-puck::after { content: ''; position: absolute; top: -12px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 10px solid #3b82f6; }
          .puck-pulse { position: absolute; width: 60px; height: 60px; top: -21px; left: -21px; border-radius: 50%; background: rgba(59, 130, 246, 0.2); animation: pulse 2s infinite; pointer-events: none; z-index: -1; }
          @keyframes pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } }
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          .mapboxgl-popup { z-index: 10 !important; }
        `}</style>
        
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-zinc-500 text-xs tracking-widest uppercase">កំពុងដំណើរការ...</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full touch-none" />

        <WeatherWidget weather={weather} isNavigating={isNavigating.current} />

        {routeDetails ? (
           <NavigationHUD 
              routeDetails={routeDetails} 
              isMuted={isMuted} 
              setIsMuted={setIsMuted} 
              currentSpeed={currentSpeed}
              onClearRoute={clearRoute}
           />
        ) : (
           <BottomControls 
              isTrafficVisible={isTrafficVisible}
              toggleTraffic={toggleTraffic}
              resetCompass={resetCompass}
              handleCategorySearch={handleCategorySearch}
              handleAutocomplete={handleAutocomplete}
              onSelectLocation={(loc: SearchResult) => handleMapSelection(loc)}
              userLocation={userLocation}
              handleUserLocationClick={handleUserLocationClick}
              handleStyleChange={handleStyleChange}
              currentStyle={currentStyle}
           />
        )}

        {isNavigating.current && showRecenterBtn && (
             <div className="absolute bottom-32 right-4 z-20 pointer-events-auto pb-[safe-area-inset-bottom] animate-in zoom-in-50 duration-300">
                <Button onClick={handleRecenter} className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl text-blue-500 flex flex-col items-center justify-center gap-0 hover:bg-zinc-800 transition-transform active:scale-90">
                    <LocateFixed className="h-6 w-6" /><span className="text-[9px] font-bold uppercase">ទីតាំងខ្ញុំ</span>
                </Button>
             </div>
        )}

        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className={`rounded-t-3xl p-6 border-t border-zinc-800 bg-[#18181b]/95 backdrop-blur-xl text-white ring-1 ring-white/10 z-50 pb-[safe-area-inset-bottom] ${kantumruy.className}`}>
            {locationDetails && (
              <div className="space-y-6 pb-2">
                <SheetHeader className="text-left space-y-1">
                   <div className="flex items-center gap-3 mb-2">
                       <div className="h-10 w-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
                           <MapPin className="h-5 w-5 text-indigo-400" />
                       </div>
                       <div className="flex-1 min-w-0">
                           <SheetTitle asChild className="text-xl font-bold line-clamp-1 text-white">
                                <div role="heading" aria-level={2}>
                                    {isFetchingAddress ? <Skeleton className="h-6 w-32 bg-zinc-800" /> : (addressDetails?.name || "ទីតាំងដែលបានជ្រើសរើស")}
                                </div>
                           </SheetTitle>
                           <SheetDescription asChild className="text-zinc-400 text-xs line-clamp-1">
                                <div>
                                    {isFetchingAddress ? <Skeleton className="h-4 w-48 bg-zinc-800" /> : addressDetails?.formatted}
                                </div>
                           </SheetDescription>
                       </div>
                   </div>
                </SheetHeader>

                <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase mb-2 tracking-wider">Ride Hailing</p>
                        <div className="grid grid-cols-3 gap-2">
                            <Button onClick={openGrab} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-[#00B14F]/20 hover:border-[#00B14F] hover:text-[#00B14F] transition-all flex flex-col gap-0.5">
                                <CarFront className="h-4 w-4" />
                                <span className="text-[10px] font-bold">Grab</span>
                            </Button>
                            <Button onClick={openPassApp} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-[#1D8F48]/20 hover:border-[#1D8F48] hover:text-[#1D8F48] transition-all flex flex-col gap-0.5">
                                <CarFront className="h-4 w-4" />
                                <span className="text-[10px] font-bold">PassApp</span>
                            </Button>
                             <Button onClick={openGoogleMaps} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-blue-500/20 hover:border-blue-500 hover:text-blue-500 transition-all flex flex-col gap-0.5">
                                <ExternalLink className="h-4 w-4" />
                                <span className="text-[10px] font-bold">Google</span>
                            </Button>
                        </div>
                    </div>

                    {richPlaceDetails?.contact?.phone && (
                        <a href={`tel:${richPlaceDetails.contact.phone}`} className="col-span-1 flex items-center gap-2 bg-zinc-800/50 p-2.5 rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-700/50">
                            <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <Phone className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-[10px] text-zinc-400 font-bold uppercase">Phone</span>
                                <span className="text-xs text-zinc-200 truncate font-mono">{richPlaceDetails.contact.phone}</span>
                            </div>
                        </a>
                    )}
                    
                    {richPlaceDetails?.contact?.website && (
                        <a href={richPlaceDetails.contact.website} target="_blank" rel="noreferrer" className="col-span-1 flex items-center gap-2 bg-zinc-800/50 p-2.5 rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-700/50">
                            <div className="h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                                <Globe className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-[10px] text-zinc-400 font-bold uppercase">Website</span>
                                <span className="text-xs text-zinc-200 truncate">Visit Site</span>
                            </div>
                        </a>
                    )}

                    {(richPlaceDetails?.opening_hours || isFetchingRichDetails) && (
                        <div className="col-span-2 flex items-center gap-2 bg-zinc-800/50 p-2.5 rounded-xl border border-zinc-700/50">
                             <div className="h-8 w-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400">
                                <Clock className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[10px] text-zinc-400 font-bold uppercase">Hours</span>
                                {isFetchingRichDetails ? (
                                     <Skeleton className="h-3 w-24 bg-zinc-700" />
                                ) : (
                                    <span className="text-xs text-zinc-200 truncate">{richPlaceDetails.opening_hours || "Opening hours not available"}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <SheetFooter>
                  <Button 
                    className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white h-12 text-base font-semibold shadow-lg shadow-indigo-900/20 rounded-xl transition-all active:scale-[0.98]" 
                    onClick={handleStartNavigation}
                    disabled={isFetchingAddress || !userLocation.current || isRouting}
                  >
                    {isRouting ? (
                        <><Loader2 className="h-5 w-5 animate-spin" /> កំពុងគណនាផ្លូវ...</>
                    ) : userLocation.current ? (
                        <><Navigation className="h-5 w-5" /> ចាប់ផ្តើមនាំផ្លូវ</>
                    ) : (
                        <><Loader2 className="h-5 w-5 animate-spin" /> កំពុងស្វែងរក GPS</>
                    )}
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

const WeatherWidget = memo(({ weather, isNavigating }: { weather: WeatherData | null, isNavigating: boolean }) => {
    if (isNavigating || !weather) return null;
    return (
        <div className="absolute top-4 left-4 z-20 pointer-events-none">
            <div className="bg-[#18181b]/80 backdrop-blur-xl border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-2xl animate-in fade-in zoom-in-95">
                {getWeatherIcon(weather.condition)}
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-white leading-none">{weather.temp}°</span>
                    <span className="text-[10px] text-zinc-400 capitalize">{weather.description}</span>
                </div>
            </div>
        </div>
    );
});
WeatherWidget.displayName = "WeatherWidget";

const NavigationHUD = memo(({ routeDetails, isMuted, setIsMuted, currentSpeed, onClearRoute }: any) => {
    return (
        <>
        <div className="absolute top-0 left-0 right-0 z-30 pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
            <div className="w-full max-w-md mx-auto shadow-2xl bg-[#18181b] border-b-4 border-emerald-500 rounded-xl overflow-hidden pointer-events-auto ring-1 ring-white/10">
                <div className="flex items-center p-4 gap-4">
                    <div className="bg-emerald-600 h-14 w-14 rounded-lg flex items-center justify-center shadow-lg shrink-0">
                        <ManeuverIcon instruction={routeDetails.instruction} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-2xl font-bold leading-tight break-words text-white">{routeDetails.instruction}</div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-10 w-10 rounded-full bg-zinc-800/50 hover:bg-zinc-700">
                        {isMuted ? <VolumeX className="h-5 w-5 text-zinc-400" /> : <Volume2 className="h-5 w-5 text-emerald-400" />}
                    </Button>
                </div>
            </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-30 pb-[safe-area-inset-bottom]">
            <div className="bg-[#18181b]/95 backdrop-blur-xl border-t border-zinc-800 p-5 flex items-center justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
                <div className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-bold text-emerald-400 leading-none tracking-tight">{formatDuration(routeDetails.duration)}</span>
                        <span className="text-sm text-zinc-400 font-medium">remaining</span>
                    </div>
                    <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
                        <span className="text-white">{formatDistance(routeDetails.distance)}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
                        <span>{routeDetails.arrivalTime}</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center justify-center bg-zinc-900 h-14 w-14 rounded-full border-2 border-zinc-700 ring-2 ring-black/50 shadow-inner relative">
                        <span className="text-xl font-bold text-white leading-none z-10">{currentSpeed}</span>
                        <span className="text-[8px] text-zinc-500 font-bold uppercase z-10 mt-0.5">km/h</span>
                        <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"><circle cx="28" cy="28" r="26" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="163" strokeDashoffset={163 - (Math.min(currentSpeed, 120)/120)*163} className="transition-all duration-500" /></svg>
                    </div>
                    <Button size="icon" onClick={onClearRoute} className="h-12 w-12 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 shadow-lg">
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            </div>
        </div>
        </>
    );
});
NavigationHUD.displayName = "NavigationHUD";

const BottomControls = memo(({ 
    isTrafficVisible, toggleTraffic, resetCompass, 
    handleCategorySearch, handleAutocomplete, onSelectLocation, userLocation, handleUserLocationClick,
    handleStyleChange, currentStyle
}: any) => {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [history, setHistory] = useState<SearchResult[]>([]);
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
    const [isInputActive, setIsInputActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem('map_history');
            if (saved) setHistory(JSON.parse(saved));
        } catch (e) {
            localStorage.removeItem('map_history');
        }
    }, []);

    const updateHistory = (newHistory: SearchResult[]) => {
        setHistory(newHistory);
        localStorage.setItem('map_history', JSON.stringify(newHistory));
    };

    const removeFromHistory = (e: React.MouseEvent, itemToRemove: SearchResult) => {
        e.stopPropagation(); 
        const newHistory = history.filter(item => item.name !== itemToRemove.name);
        updateHistory(newHistory);
    };

    useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;

        const timeoutId = setTimeout(async () => {
            if (query.trim().length > 1) {
                setIsSearching(true);
                try {
                    const results = await handleAutocomplete(query, signal);
                    if (!signal.aborted) {
                        setSuggestions(results);
                        setIsSearching(false);
                    }
                } catch (e) { /* ignore aborts */ }
            } else {
                setSuggestions([]);
                setIsSearching(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [query, handleAutocomplete]);

    const handleSelect = (s: SearchResult) => {
        setQuery("");
        setSuggestions([]);
        setIsInputActive(false);
        const filtered = history.filter(h => h.name !== s.name && h.address !== s.address);
        const newHistory = [s, ...filtered].slice(0, 5);
        updateHistory(newHistory);
        onSelectLocation(s);
        inputRef.current?.blur(); 
    }

    const handleCloseSearch = () => {
        setIsInputActive(false);
        setSuggestions([]);
        setQuery("");
        inputRef.current?.blur();
    }

    const calcDist = (lat: number, lng: number) => {
        if(!userLocation.current) return null;
        return formatDistance(getDistanceFromLatLonInMeters(userLocation.current[1], userLocation.current[0], lat, lng));
    }

    // Condition to show the card: Only when input is active AND (there is history OR there are suggestions)
    const showCard = isInputActive && ((query.length === 0 && history.length > 0) || suggestions.length > 0);

    return (
        <div className="absolute bottom-6 left-0 right-0 px-4 z-20 flex flex-col gap-3 pointer-events-none pb-[safe-area-inset-bottom]">
            <div className={`flex justify-end gap-3 pointer-events-auto pb-2 transition-opacity duration-300 ${isInputActive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button size="icon" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800">
                            <Layers className="h-5 w-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-[#18181b]/95 border-zinc-800 text-white backdrop-blur-xl">
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.DARK)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800">
                            <Layers className="mr-2 h-4 w-4" /> Dark
                            {currentStyle === STYLES.DARK && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.LIGHT)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800">
                            <MapIcon className="mr-2 h-4 w-4" /> Street
                            {currentStyle === STYLES.LIGHT && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.SATELLITE)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800">
                            <Satellite className="mr-2 h-4 w-4" /> Satellite
                            {currentStyle === STYLES.SATELLITE && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                 <Button size="icon" onClick={handleUserLocationClick} className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800">
                    <Crosshair className="h-5 w-5" />
                </Button>
                <Button size="icon" onClick={toggleTraffic} className={`h-11 w-11 rounded-full border shadow-xl backdrop-blur-md transition-all ${isTrafficVisible ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900/80 border-zinc-700 text-zinc-400'}`}>
                    <Zap className="h-5 w-5" />
                </Button>
                <Button size="icon" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass}>
                    <Compass className="h-5 w-5" />
                </Button>
            </div>

            <div className={`flex gap-2 overflow-x-auto no-scrollbar pointer-events-auto pb-1 pl-1 transition-all duration-300 ease-out ${isInputActive || query.length > 0 ? 'opacity-0 translate-y-4 pointer-events-none h-0' : 'opacity-100 translate-y-0 h-10'}`}>
                <Button onClick={() => handleCategorySearch("gas station")} className="rounded-full shadow-lg bg-white/10 backdrop-blur-md border border-white/10 px-4 h-10 text-xs font-medium shrink-0 hover:bg-white/20 text-white">
                    <Fuel className="h-3.5 w-3.5 mr-2 text-orange-400" /> ប្រេង
                </Button>
                <Button onClick={() => handleCategorySearch("restaurant")} className="rounded-full shadow-lg bg-white/10 backdrop-blur-md border border-white/10 px-4 h-10 text-xs font-medium shrink-0 hover:bg-white/20 text-white">
                    <Utensils className="h-3.5 w-3.5 mr-2 text-rose-400" /> អាហារ
                </Button>
                <Button onClick={() => handleCategorySearch("coffee")} className="rounded-full shadow-lg bg-white/10 backdrop-blur-md border border-white/10 px-4 h-10 text-xs font-medium shrink-0 hover:bg-white/20 text-white">
                    <Coffee className="h-3.5 w-3.5 mr-2 text-amber-400" /> កាហ្វេ
                </Button>
                <Button onClick={() => handleCategorySearch("bank")} className="rounded-full shadow-lg bg-white/10 backdrop-blur-md border border-white/10 px-4 h-10 text-xs font-medium shrink-0 hover:bg-white/20 text-white">
                    <Banknote className="h-3.5 w-3.5 mr-2 text-emerald-400" /> ធនាគារ
                </Button>
                 <Button onClick={() => handleCategorySearch("school")} className="rounded-full shadow-lg bg-white/10 backdrop-blur-md border border-white/10 px-4 h-10 text-xs font-medium shrink-0 hover:bg-white/20 text-white">
                    <GraduationCap className="h-3.5 w-3.5 mr-2 text-blue-400" /> សាលា
                </Button>
            </div>

            <div className="pointer-events-auto flex flex-col gap-2 relative group">
                {isInputActive && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[-1] animate-in fade-in" onClick={handleCloseSearch} />
                )}
                
                {showCard && (
                    <Card className="absolute bottom-16 left-0 right-0 bg-[#18181b]/95 backdrop-blur-xl border-zinc-800/50 max-h-[50vh] overflow-y-auto shadow-2xl z-30 animate-in fade-in slide-in-from-bottom-4 duration-300 rounded-2xl scrollbar-thin">
                        <CardContent className="p-0">
                            
                            {query.length === 0 && history.length > 0 && (
                                <div className="border-b border-white/5 transition-all duration-300">
                                    <div 
                                        onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
                                        className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors bg-zinc-900/50 sticky top-0 backdrop-blur-md z-10"
                                    >
                                        <div className="flex items-center gap-2">
                                            <History className="h-3.5 w-3.5 text-indigo-400" />
                                            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                                                Recent History ({history.length})
                                            </span>
                                        </div>
                                        {isHistoryExpanded ? (
                                            <ChevronUp className="h-4 w-4 text-zinc-500" />
                                        ) : (
                                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                                        )}
                                    </div>

                                    <div className={`overflow-hidden transition-all duration-300 ${isHistoryExpanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}>
                                        {history.map((s, i) => (
                                            <div key={`hist-${i}`} onClick={() => handleSelect(s)} className="p-2.5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3 group relative pl-4 border-b border-white/5 last:border-0">
                                                <div className="bg-zinc-800/50 p-1.5 rounded-full shrink-0 group-hover:bg-zinc-700 transition-colors">
                                                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                                                </div>
                                                <div className="min-w-0 flex-1 pr-8">
                                                    <div className="text-sm font-medium text-zinc-200 truncate leading-tight">{s.name}</div>
                                                    <div className="text-[10px] text-zinc-500 truncate mt-0.5">{s.address}</div>
                                                </div>
                                                <button 
                                                    onClick={(e) => removeFromHistory(e, s)}
                                                    className="absolute right-2 p-2 rounded-full hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {suggestions.map((s, i) => {
                                const dist = calcDist(s.lat, s.lng);
                                return (
                                <div key={i} onClick={() => handleSelect(s)} className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3 group last:border-0">
                                    <div className="bg-zinc-800/80 p-2 rounded-full shrink-0 group-hover:bg-indigo-500/20 transition-colors"><MapPin className="h-4 w-4 text-zinc-400 group-hover:text-indigo-400" /></div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-center mb-0.5">
                                            <div className="text-sm font-semibold text-zinc-200 truncate pr-2">
                                                <HighlightMatch text={s.name} match={query} />
                                            </div>
                                            {dist && <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-md border border-indigo-500/20 shrink-0">{dist}</span>}
                                        </div>
                                        <div className="text-xs text-zinc-500 truncate">{s.address}</div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-zinc-600 ml-auto shrink-0 group-hover:text-zinc-400" />
                                </div>
                            )})}
                        </CardContent>
                    </Card>
                )}

                <div className="relative shadow-2xl transition-all duration-300 ease-out active:scale-[0.99]">
                    <Search className={`absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors ${isSearching ? 'text-indigo-400' : 'text-zinc-400'}`} />
                    <input 
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => { setIsInputActive(true); if(history.length > 0 && query.length === 0) setSuggestions([]); }} 
                        placeholder="ស្វែងរកទីតាំង, ហាង, ឬ បញ្ចូលកូអរដោនេ..." 
                        className="w-full h-14 pl-12 pr-12 rounded-full bg-[#18181b]/90 backdrop-blur-md border border-white/10 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-base shadow-inner transition-all focus:bg-[#18181b]"
                    />
                    {isSearching ? (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-500 animate-spin" />
                    ) : (query.length > 0 || isInputActive) && (
                        <button onClick={handleCloseSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});
BottomControls.displayName = "BottomControls";