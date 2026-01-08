'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl, { GeolocateControl, Marker } from 'mapbox-gl';
// @ts-ignore
import MapboxDirections from '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Navigation2, X, MapPin, Navigation, LocateFixed, Clock, ArrowRight, Volume2, VolumeX, Compass, Loader2, AlertTriangle } from 'lucide-react';

// --- SAFE TOKEN INITIALIZATION ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
}

const initialCenter: [number, number] = [104.9282, 11.5564];
const initialZoom = 13;
const mapStyle = 'mapbox://styles/mapbox/dark-v11';

// --- UTILITIES ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

export default function MapExplorerPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const directionsControl = useRef<any | null>(null);
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  
  // Refs
  const userLocation = useRef<[number, number] | null>(null);
  const isNavigating = useRef<boolean>(false);
  const lastCameraUpdate = useRef<number>(0);
  const lastSpokenInstruction = useRef<string>("");
  const isMounted = useRef<boolean>(true);

  const { toast } = useToast();
  
  // UI State
  const [locationDetails, setLocationDetails] = useState<{lng: number, lat: number} | null>(null);
  const [addressDetails, setAddressDetails] = useState<any>(null);
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  
  const [routeDetails, setRouteDetails] = useState<{
    distance: number; 
    duration: number;
    instruction: string;
    arrivalTime: string;
  } | null>(null);

  const showRecenterBtnRef = useRef(false);
  const isMutedRef = useRef(false);

  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // --- VOICE LOGIC ---
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('Samantha')) && v.lang.includes('en')) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.0; 
    window.speechSynthesis.speak(utterance);
  }, []);

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    isMounted.current = true;
    
    // CRITICAL FIX: Don't initialize map if token is missing
    if (!MAPBOX_TOKEN) return; 
    
    if (map.current || !mapContainer.current) return;
    
    if (mapContainer.current.hasChildNodes()) {
        mapContainer.current.innerHTML = ''; 
    }
    
    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: initialCenter,
      zoom: initialZoom,
      pitch: 0, 
      bearing: 0,
      attributionControl: false,
      antialias: true,
      maxTileCacheSize: 10,
      logoPosition: 'bottom-left',
      cooperativeGestures: true,
      fadeDuration: 300, 
    });

    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      trackUserLocation: true,
      showUserHeading: true,
      showUserLocation: true,
      showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    let initTimer: NodeJS.Timeout;

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        geolocate.trigger();

        initTimer = setTimeout(() => {
             if (isMounted.current && map.current) {
                initializeDirectionsPlugin(mapInstance);
                add3DBuildings(mapInstance);
             }
        }, 600); 
    });

    // --- REAL TIME UPDATES ---
    geolocate.on('geolocate', (e: any) => {
      const pos = e.coords;
      const newLat = pos.latitude;
      const newLng = pos.longitude;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      
      if(isMounted.current) setCurrentSpeed(speedKmh);

      const prevLocation = userLocation.current;
      userLocation.current = [newLng, newLat];

      if (isNavigating.current && directionsControl.current) {
         directionsControl.current.setOrigin([newLng, newLat]);

         const now = Date.now();
         let distanceMoved = 100;
         if (prevLocation) {
             distanceMoved = getDistanceFromLatLonInMeters(prevLocation[1], prevLocation[0], newLat, newLng);
         }

         if (!showRecenterBtnRef.current) {
             const heading = pos.heading;
             const shouldUpdateBearing = speedKmh > 5 && heading !== undefined && heading !== null;
             const targetBearing = shouldUpdateBearing ? heading : mapInstance.getBearing();
             const targetZoom = Math.max(16.5, Math.min(18.5, 18.5 - (speedKmh / 80)));

             if (distanceMoved > 2 || (now - lastCameraUpdate.current > 1000)) {
                 lastCameraUpdate.current = now;
                 mapInstance.easeTo({
                     center: [newLng, newLat],
                     zoom: targetZoom,
                     pitch: 55,
                     bearing: targetBearing,
                     duration: 1000,
                     easing: (t) => t
                 });
             }
         }
      }
    });
    
    mapInstance.on('dragstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });
    mapInstance.on('pitchstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });

    const markerObserver = new MutationObserver((mutations) => {
        let shouldCleanup = false;
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) shouldCleanup = true;
        });
        if (shouldCleanup) {
             requestAnimationFrame(() => {
                 const badElements = document.querySelectorAll('.mapbox-directions-destination, .mapbox-directions-origin, .mapbox-directions-step');
                 if(badElements.length > 0) badElements.forEach(el => el.remove());
             });
        }
    });

    if (mapContainer.current) {
        markerObserver.observe(mapContainer.current, { childList: true, subtree: true });
    }

    const onMapClick = (e: mapboxgl.MapMouseEvent) => {
      if(isNavigating.current) return;

      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      
      if (directionsControl.current) directionsControl.current.removeRoutes();
      if (destinationMarker.current) destinationMarker.current.remove();
      
      mapInstance.easeTo({ pitch: 0, bearing: 0, zoom: 15, duration: 800 });
      
      const newMarker = new Marker({ color: '#ef4444' })
        .setLngLat(e.lngLat)
        .addTo(mapInstance);
      destinationMarker.current = newMarker;

      setLocationDetails(e.lngLat);
      setIsDrawerOpen(true);

      mapInstance.flyTo({
        center: e.lngLat,
        zoom: 15,
        offset: [0, 150],
        essential: true
      });
    };

    mapInstance.on('click', onMapClick);

    // --- HELPER FUNCTIONS ---
    const initializeDirectionsPlugin = (instance: mapboxgl.Map) => {
        if(directionsControl.current) return; 

        // CRITICAL: PASS TOKEN DIRECTLY
        const directions = new MapboxDirections({
            accessToken: MAPBOX_TOKEN, 
            unit: 'metric',
            profile: 'mapbox/driving',
            interactive: false,
            controls: { inputs: false, instructions: false, profileSwitcher: false },
            alternatives: false,
            flyTo: false
        });
        instance.addControl(directions, 'top-left');
        directionsControl.current = directions;

        directions.on('route', (e: any) => {
          if (!isMounted.current) return;
          if (e.route && e.route.length > 0) {
            const route = e.route[0];
            const leg = route.legs[0];
            
            const firstStep = leg.steps[0]?.maneuver?.instruction;
            const secondStep = leg.steps[1]?.maneuver?.instruction;
            const instructionText = (leg.steps[0]?.distance < 20 && secondStep) ? secondStep : (firstStep || "Follow Route");

            const now = new Date();
            const arrivalDate = new Date(now.getTime() + route.duration * 1000);
            const arrivalString = arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            setRouteDetails({
              distance: route.distance,
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: arrivalString
            });
            
            styleRouteLayers(instance);
            setTimeout(() => styleRouteLayers(instance), 300);
          }
      });
    }

    const add3DBuildings = (instance: mapboxgl.Map) => {
        if (!instance.getStyle() || !instance.getSource('composite')) return;
        const layers = instance.getStyle().layers;
        const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;

        if(!instance.getLayer('3d-buildings')) {
            try {
                instance.addLayer({
                    'id': '3d-buildings',
                    'source': 'composite',
                    'source-layer': 'building',
                    'filter': ['==', 'extrude', 'true'],
                    'type': 'fill-extrusion',
                    'minzoom': 14,
                    'paint': {
                        'fill-extrusion-color': '#242424',
                        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
                        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
                        'fill-extrusion-opacity': 0.85
                    }
                }, labelLayerId);
            } catch (e) {
                console.warn("3D buildings error", e);
            }
        }
    }

    const styleRouteLayers = (instance: mapboxgl.Map) => {
          if (instance.getLayer('directions-route-line-casing')) {
              instance.setPaintProperty('directions-route-line-casing', 'line-color', '#1e3a8a');
              instance.setPaintProperty('directions-route-line-casing', 'line-width', 12);
              instance.setPaintProperty('directions-route-line-casing', 'line-opacity', 0.9);
          }
          if (instance.getLayer('directions-route-line')) {
              instance.setPaintProperty('directions-route-line', 'line-color', '#3b82f6');
              instance.setPaintProperty('directions-route-line', 'line-width', 6);
              instance.setPaintProperty('directions-route-line', 'line-opacity', 1);
          }
    };

    return () => {
      isMounted.current = false;
      clearTimeout(initTimer);
      markerObserver.disconnect();
      mapInstance.off('click', onMapClick);
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    }
  }, []); 
  
  // --- EFFECTS ---
  useEffect(() => {
    if (routeDetails?.instruction && isNavigating.current) {
        if (lastSpokenInstruction.current !== routeDetails.instruction) {
            speak(routeDetails.instruction);
            lastSpokenInstruction.current = routeDetails.instruction;
        }
    }
  }, [routeDetails, speak]);

  useEffect(() => {
    if (locationDetails) {
      const fetchAddress = async () => {
        setIsFetchingAddress(true);
        const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
        if (!apiKey) {
           setAddressDetails({ formatted: "Unknown Location" });
           setIsFetchingAddress(false);
           return;
        }
        try {
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}`);
          const data = await response.json();
          if (isMounted.current && data.features && data.features.length > 0) {
            setAddressDetails(data.features[0].properties);
          } else if (isMounted.current) {
            setAddressDetails({ formatted: "Unknown Location" });
          }
        } catch (error) {
          if (isMounted.current) setAddressDetails({ formatted: "Address unavailable" });
        } finally {
          if (isMounted.current) setIsFetchingAddress(false);
        }
      };
      fetchAddress();
    }
  }, [locationDetails]);

  // --- ACTIONS ---
  const handleStartNavigation = () => {
    if (!userLocation.current) {
      toast({ title: "Locating...", description: "Waiting for GPS." });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    
    isNavigating.current = true;
    setShowRecenterBtn(false);

    if (!isMuted) speak("Starting route");
    
    if (directionsControl.current) {
      directionsControl.current.setOrigin(userLocation.current);
      directionsControl.current.setDestination([locationDetails.lng, locationDetails.lat]);
    }
    
    setIsDrawerOpen(false);

    if(map.current) {
        map.current.flyTo({
            center: userLocation.current,
            zoom: 18,
            pitch: 55,
            bearing: 0,
            essential: true,
            duration: 1500
        });
    }
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      setShowRecenterBtn(false);
      
      map.current.flyTo({
          center: userLocation.current,
          zoom: 18,
          pitch: 55,
          bearing: map.current.getBearing(), 
          duration: 1000
      });
  }

  const resetCompass = () => {
    if(map.current) {
        map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
    }
  }

  const clearRoute = () => {
    isNavigating.current = false;
    window.speechSynthesis.cancel();
    if (directionsControl.current) directionsControl.current.removeRoutes();
    if (destinationMarker.current) {
      destinationMarker.current.remove();
      destinationMarker.current = null;
    }
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    
    if(map.current && userLocation.current) {
        map.current.flyTo({ center: userLocation.current, zoom: 14, pitch: 0, bearing: 0, duration: 1000 });
    }
  }

  const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`;
  const formatDuration = (s: number) => {
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    return `${hours}h ${mins}m`;
  }

  // --- RENDER IF NO TOKEN ---
  if (!MAPBOX_TOKEN) {
      return (
          <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6">
              <Card className="w-full max-w-md bg-zinc-900 border-red-900/50">
                  <CardContent className="flex flex-col items-center gap-4 p-6">
                      <div className="rounded-full bg-red-900/20 p-4">
                          <AlertTriangle className="h-8 w-8 text-red-500" />
                      </div>
                      <h2 className="text-xl font-bold">Configuration Error</h2>
                      <p className="text-center text-zinc-400">
                          Mapbox Access Token is missing. 
                      </p>
                      <div className="w-full rounded bg-zinc-950 p-4 font-mono text-xs text-zinc-500 break-all">
                          NEXT_PUBLIC_MAPBOX_TOKEN=pk...
                      </div>
                      <p className="text-sm text-zinc-500">Please add this to your .env.local file.</p>
                  </CardContent>
              </Card>
          </div>
      )
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-zinc-950 font-sans text-zinc-50">
        
        {/* Loading Overlay */}
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white ${isMapLoaded ? 'loader-fade-out' : ''}`}>
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-4" />
            <p className="text-zinc-400 text-sm">Initializing Map...</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {/* HUD */}
        {routeDetails && (
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
            <Card className="w-full max-w-md shadow-2xl bg-zinc-900/95 backdrop-blur-md border-zinc-700 text-white pointer-events-auto rounded-xl">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="bg-green-600 p-3 rounded-lg text-white shadow-lg shrink-0 mt-1 animate-in zoom-in-50">
                        <ArrowRight className="h-8 w-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                         <div className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-0.5">Next Step</div>
                         <div className="text-xl font-bold leading-tight break-words text-white">
                             {routeDetails.instruction}
                         </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                         <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400">
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-green-400" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={clearRoute} className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold tracking-tight text-green-400">
                            {formatDuration(routeDetails.duration)}
                        </span>
                        <span className="text-sm font-medium text-zinc-400">
                            ({formatDistance(routeDetails.distance)})
                        </span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center justify-center bg-zinc-800 h-8 w-12 rounded-md border border-zinc-700 mr-2">
                             <span className="text-sm font-bold text-white">{currentSpeed}</span>
                             <span className="text-[9px] text-zinc-500 ml-0.5 mt-0.5">km/h</span>
                        </div>
                        <div className="flex items-center gap-2 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
                            <Clock className="h-4 w-4 text-blue-400" />
                            <span className="text-sm font-semibold text-blue-100">
                            {routeDetails.arrivalTime}
                            </span>
                        </div>
                    </div>
                </div>

              </CardContent>
            </Card>
          </div>
        )}

        <div className="absolute right-4 bottom-32 flex flex-col gap-3 pointer-events-auto">
             {!isNavigating.current && (
                 <Button 
                    size="icon" 
                    className="h-12 w-12 rounded-full bg-zinc-900/90 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 shadow-xl"
                    onClick={resetCompass}
                 >
                    <Compass className="h-6 w-6" />
                 </Button>
             )}

             {showRecenterBtn && (
                <Button 
                    onClick={handleRecenter}
                    className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl hover:bg-zinc-800 text-blue-500 flex flex-col items-center justify-center gap-0 animate-in slide-in-from-right-10 fade-in duration-300"
                >
                    <LocateFixed className="h-6 w-6" />
                    <span className="text-[10px] font-bold">Re-center</span>
                </Button>
             )}
        </div>

        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className="rounded-t-2xl p-6 border-zinc-800 sm:max-w-md sm:mx-auto bg-zinc-950 text-white mb-[safe-area-inset-bottom]">
            {locationDetails && (
              <div className="space-y-5 pb-4">
                <SheetHeader className="text-left space-y-2">
                   <SheetTitle className="text-xl font-bold line-clamp-2 leading-tight text-white">
                        {isFetchingAddress ? (
                            <Skeleton className="h-7 w-2/3 bg-zinc-800" />
                        ) : (
                            addressDetails?.formatted || "Selected Location"
                        )}
                   </SheetTitle>
                   <SheetDescription asChild>
                      <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        {isFetchingAddress ? (
                             <Skeleton className="h-5 w-1/3 bg-zinc-800" />
                        ) : (
                             <>
                                <MapPin className="h-4 w-4" />
                                {locationDetails.lat.toFixed(5)}, {locationDetails.lng.toFixed(5)}
                             </>
                        )}
                      </div>
                   </SheetDescription>
                </SheetHeader>

                <SheetFooter className="pt-2">
                  <Button className="w-full gap-2 bg-blue-600 active:bg-blue-700 text-white h-12 text-lg font-medium shadow-blue-900/20 shadow-lg" onClick={handleStartNavigation}>
                    <Navigation className="h-5 w-5" /> Start Navigation
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}