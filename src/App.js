import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const App = () => {
  // Application state
  const [selectedMonth, setSelectedMonth] = useState(6);
  const [selectedDay, setSelectedDay] = useState(15);
  const [darkMode, setDarkMode] = useState(true);
  const [mapCenter, setMapCenter] = useState([30, 10]);
  const [mapZoom, setMapZoom] = useState(2);
  const [mapMarkers, setMapMarkers] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [markerPositions, setMarkerPositions] = useState({});

  // Reference to the map
  const mapRef = useRef(null);
  
  // State for expanded sections
  const [expandedSections, setExpandedSections] = useState({
    powerSources: true,
    sourceDetails: true,
    electrolyzer: false,
    financial: false
  });

  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
  // Create a helper function for getting days in month
  const getDaysInMonth = (month) => {
    const daysInMonths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return daysInMonths[month - 1];
  };

  // Function to extract a single day's data
  const getSelectedDayData = (timeSeriesData) => {
    if (!timeSeriesData || timeSeriesData.length === 0) {
      return Array(24).fill(0).map((_, hour) => ({ hour, value: 0 }));
    }
    
    // Calculate start index for the selected day
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let dayOfYear = selectedDay;
    
    // Add days from previous months
    for (let m = 1; m < selectedMonth; m++) {
      dayOfYear += daysInMonth[m-1];
    }
    
    // Convert to 0-indexed
    dayOfYear -= 1;
    
    // Calculate starting hour in the dataset
    const startHour = dayOfYear * 24;
    
    // Prepare the day data
    const dayData = [];
    for (let hour = 0; hour < 24; hour++) {
      const index = startHour + hour;
      
      if (index >= 0 && index < timeSeriesData.length) {
        dayData.push({
          hour,
          value: timeSeriesData[index]
        });
      } else {
        dayData.push({ hour, value: 0 });
      }
    }
    
    return dayData;
  };

  const [inputs, setInputs] = useState({
    powerSources: [
      {
        type: 'grid',
        capacity: 100, // MW
        capex: 0, // $/kW
        opex: 80, // $/kW/year
        electricityPrice: 0.05, // $/kWh
        lcoe: 0.05, // $/kWh
        timeSeriesData: null,
      },
      {
        type: 'solar',
        capacity: 150, // MW
        capex: 1000, // $/kW
        opex: 20, // $/kW/year
        lcoe: null, // Will be calculated from time series
        timeSeriesData: null,
        location: { lat: 38.9, lng: -77.0 }, // Default location (Washington DC)
        year: 2022 // Year for solar data
      },
      {
        type: 'wind',
        capacity: 100, // MW
        capex: 1200, // $/kW
        opex: 25, // $/kW/year
        lcoe: null, // Will be calculated from time series
        timeSeriesData: null,
        location: { lat: 42.3, lng: -71.0 }, // Default location (Boston)
        year: 2022 // Year for wind data
      }
    ],
    electrolyzer: {
      capacity: 100, // MW
      capex: 800, // $/kW
      opex: 40, // $/kW/year
      efficiency: 70, // %
      baseConsumption: 50, // kWh/kg H₂ at 100% efficiency
    },
    financial: {
      returnRate: 8, // %
      lifetime: 20, // years
      capacityFactor: 90, // %
      annualHours: 8760, // hours
    },
    apis: {
      renewableNinjaToken: "",
    }
  });
  
  const [results, setResults] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [selectedPowerSource, setSelectedPowerSource] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [apiError, setApiError] = useState("");

  // Update map markers when power sources change
  useEffect(() => {
    const newMarkers = inputs.powerSources
      .filter(source => source.type !== 'grid' && source.location)
      .map((source, index) => ({
        id: index,
        position: [source.location.lat, source.location.lng],
        type: source.type,
        capacity: source.capacity,
        powerSourceIndex: inputs.powerSources.findIndex(s => s === source)
      }));
    
    setMapMarkers(newMarkers);
    
    // Create a lookup of marker positions by power source index
    const positions = {};
    inputs.powerSources.forEach((source, index) => {
      if (source.type !== 'grid' && source.location) {
        positions[index] = [source.location.lat, source.location.lng];
      }
    });
    setMarkerPositions(positions);
  }, [inputs.powerSources]);

  // Calculate timezone offset based on longitude
  const calculateTimezoneOffset = (longitude) => {
    return Math.round(longitude / 15);
  };
  
  // Apply timezone correction to hourly data array
  const applyTimezoneCorrection = (hourlyData, offset) => {
    if (offset === 0) {
      return hourlyData;
    }
    
    const shiftedData = new Array(hourlyData.length).fill(0);
    
    for (let day = 0; day < 365; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const originalIndex = day * 24 + hour;
        
        let localHour = hour - offset;
        let localDay = day;
        
        if (localHour < 0) {
          localHour += 24;
          localDay -= 1;
          if (localDay < 0) localDay = 364;
        } else if (localHour >= 24) {
          localHour -= 24;
          localDay += 1;
          if (localDay >= 365) localDay = 0;
        }
        
        const localIndex = localDay * 24 + localHour;
        
        if (originalIndex < hourlyData.length && localIndex < hourlyData.length) {
          shiftedData[originalIndex] = hourlyData[localIndex];
        }
      }
    }
    
    return shiftedData;
  };

  // PVGIS API for solar data
  const fetchPVGISData = (sourceIndex) => {
    setIsDownloading(true);
    setApiError("");
    
    const source = inputs.powerSources[sourceIndex];
    
    if (!source.location || !source.location.lat || !source.location.lng) {
      setApiError("Please provide a valid location (latitude and longitude)");
      setIsDownloading(false);
      return;
    }
    
    const { lat, lng } = source.location;
    const year = source.year || 2022;
    
    const corsProxy = "https://cors-anywhere.herokuapp.com/";
    
    const pvgisUrl = `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?` +
      `lat=${lat}&lon=${lng}&` +
      `startyear=${year}&endyear=${year}&` +
      `pvcalculation=1&peakpower=1&` +
      `trackingtype=5&`+
      `loss=10&`+
      `hourlydata=1&`+
      `components=1&`+
      `outputformat=json&` +
      `optimalinclination=1&` +
      `mountingplace=free`;
    
    fetch(corsProxy + pvgisUrl)
      .then(response => {
        if (!response.ok) {
          return response.text().then(text => {
            throw new Error(`PVGIS API Error: ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        const hourlyData = [];
        
        if (data && data.outputs && data.outputs.hourly) {
          data.outputs.hourly.forEach(hour => {
            const capacityFactor = hour.P / 1000;
            hourlyData.push(Math.max(0, Math.min(1, capacityFactor)));
          });
          
          const locationLongitude = source.location.lng;
          const timezoneOffset = calculateTimezoneOffset(locationLongitude);
          
          const timezoneCorrectedData = applyTimezoneCorrection(hourlyData, timezoneOffset);
          
          const fullYearData = new Array(8760).fill(0);
          for (let i = 0; i < Math.min(timezoneCorrectedData.length, 8760); i++) {
            fullYearData[i] = timezoneCorrectedData[i];
          }
          
          setInputs(prevInputs => {
            const newInputs = {...prevInputs};
            newInputs.powerSources[sourceIndex].timeSeriesData = fullYearData;
            
            newInputs.powerSources[sourceIndex].lcoe = calculateLCOE(
              newInputs.powerSources[sourceIndex],
              fullYearData,
              newInputs.financial
            );
            
            return newInputs;
          });
        } else {
          throw new Error("Invalid PVGIS data format");
        }
        
        setIsDownloading(false);
      })
      .catch(error => {
        setApiError(`Error fetching solar data: ${error.message}`);
        setIsDownloading(false);
      });
  };
  
  // Renewable Ninja API for wind data
  const fetchRenewableNinjaData = (sourceIndex) => {
    setIsDownloading(true);
    setApiError("");
    
    const source = inputs.powerSources[sourceIndex];
    const token = inputs.apis.renewableNinjaToken;
    
    if (!token || token.trim() === "") {
      setApiError("Renewable Ninja API requires a valid API token");
      setIsDownloading(false);
      return;
    }
    
    const { lat, lng } = source.location;
    const year = source.year || 2022;
    
    const params = new URLSearchParams({
      lat: lat,
      lon: lng,
      date_from: `${year}-01-01`,
      date_to: `${year}-12-31`,
      capacity: 1.0,
      height: 100,
      turbine: 'Vestas V90 2000',
      format: 'json'
    });
    
    const corsProxy = "https://cors-anywhere.herokuapp.com/";
    const apiUrl = `https://www.renewables.ninja/api/data/wind?${params.toString()}`;
    
    fetch(corsProxy + apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json',
        'Origin': window.location.origin
      }
    })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => {
          throw new Error(`Renewable Ninja API Error: ${response.status}`);
        });
      }
      return response.json();
    })
    .then(data => {
      const hourlyData = [];
      
      if (data.data) {
        Object.keys(data.data).forEach(timestamp => {
          const capacityFactor = data.data[timestamp].electricity;
          
          if (capacityFactor !== undefined) {
            hourlyData.push(Math.max(0, Math.min(1, capacityFactor)));
          } else {
            hourlyData.push(0);
          }
        });
      } else {
        throw new Error("Invalid Renewable Ninja data format");
      }
      
      const fullYearData = new Array(8760).fill(0);
      for (let i = 0; i < Math.min(hourlyData.length, 8760); i++) {
        fullYearData[i] = hourlyData[i];
      }
      
      setInputs(prevInputs => {
        const newInputs = {...prevInputs};
        newInputs.powerSources[sourceIndex].timeSeriesData = fullYearData;
        
        newInputs.powerSources[sourceIndex].lcoe = calculateLCOE(
          newInputs.powerSources[sourceIndex],
          fullYearData,
          newInputs.financial
        );
        
        return newInputs;
      });
      
      setIsDownloading(false);
    })
    .catch(error => {
      setApiError(`Error fetching wind data: ${error.message}`);
      setIsDownloading(false);
    });
  };
  
  // Calculate LCOE from time series data
  const calculateLCOE = (source, timeSeriesData, financialParams) => {
    const { capex, opex, capacity } = source;
    const { returnRate, lifetime } = financialParams;
    
    const capacityKW = capacity * 1000;
    
    let annualEnergyProduction = 0;
    if (timeSeriesData && timeSeriesData.length > 0) {
      timeSeriesData.forEach(capacityFactor => {
        annualEnergyProduction += capacity * capacityFactor; // MWh
      });
      
      annualEnergyProduction *= 1000;
    } else {
      const averageCapacityFactor = financialParams.capacityFactor / 100;
      annualEnergyProduction = capacityKW * averageCapacityFactor * 8760;
    }
    
    const discountRate = returnRate / 100;
    let totalPresentValueCost = capex * capacityKW;
    
    for (let year = 1; year <= lifetime; year++) {
      const yearlyOpex = opex * capacityKW;
      totalPresentValueCost += yearlyOpex / Math.pow(1 + discountRate, year);
    }
    
    let totalPresentValueEnergy = 0;
    for (let year = 1; year <= lifetime; year++) {
      totalPresentValueEnergy += annualEnergyProduction / Math.pow(1 + discountRate, year);
    }
    
    const lcoe = totalPresentValueCost / totalPresentValueEnergy;
    return lcoe;
  };
  
  // Calculate LCOH when requested
  const calculateLCOH = () => {
    setCalculating(true);
    
    const updatedSources = [...inputs.powerSources].map(source => {
      if (source.type !== 'grid' && !source.lcoe && source.timeSeriesData) {
        source.lcoe = calculateLCOE(source, source.timeSeriesData, inputs.financial);
      }
      return source;
    });
    
    setInputs(prev => ({...prev, powerSources: updatedSources}));
    
    setTimeout(() => {
      const { electrolyzer, financial } = inputs;
      
      const sortedSources = [...updatedSources].sort((a, b) => {
        if (!a.lcoe) return 1;
        if (!b.lcoe) return -1;
        return a.lcoe - b.lcoe;
      });
      
      const actualEnergyPerKg = electrolyzer.baseConsumption / (electrolyzer.efficiency / 100);
      
      const hourlyDispatch = [];
      let totalEnergyUsed = 0;
      let totalCurtailedEnergy = 0;
      const energyBySource = {};
      
      for (let hour = 0; hour < 8760; hour++) {
        let hourlyEnergyUsed = 0;
        let hourlyCurtailed = 0;
        const sourceDispatch = [];
        let remainingDemand = electrolyzer.capacity;
        
        for (const source of sortedSources) {
          if (remainingDemand <= 0) break;
          
          if (!source.lcoe) continue;
          
          let capacityFactor;
          if (source.timeSeriesData && source.timeSeriesData.length > hour) {
            capacityFactor = source.timeSeriesData[hour];
          } else if (source.type === 'grid') {
            capacityFactor = 1.0;
          } else {
            capacityFactor = financial.capacityFactor / 100;
          }
          
          const availablePower = source.capacity * capacityFactor;
          
          const powerUsed = Math.min(availablePower, remainingDemand);
          
          const powerCurtailed = Math.max(0, availablePower - powerUsed);
          
          remainingDemand -= powerUsed;
          hourlyEnergyUsed += powerUsed;
          hourlyCurtailed += powerCurtailed;
          
          if (!energyBySource[source.type]) {
            energyBySource[source.type] = 0;
          }
          energyBySource[source.type] += powerUsed;
          
          sourceDispatch.push({
            type: source.type,
            powerUsed,
            powerCurtailed
          });
        }
        
        totalEnergyUsed += hourlyEnergyUsed;
        totalCurtailedEnergy += hourlyCurtailed;
        
        hourlyDispatch.push({
          hour,
          energyUsed: hourlyEnergyUsed,
          curtailedEnergy: hourlyCurtailed,
          dispatchPercentage: hourlyEnergyUsed / electrolyzer.capacity,
          sources: sourceDispatch
        });
      }
      
      const annualH2Production = (totalEnergyUsed * 1000) / actualEnergyPerKg;
      
      const discountRate = financial.returnRate / 100;
      const crf = (discountRate * Math.pow(1 + discountRate, financial.lifetime)) / 
                  (Math.pow(1 + discountRate, financial.lifetime) - 1);
      
      let totalPowerSourceCapex = 0;
      updatedSources.forEach(source => {
        const sourceCapex = source.capacity * 1000 * source.capex;
        const annualizedSourceCapex = sourceCapex * crf;
        totalPowerSourceCapex += annualizedSourceCapex;
      });
      
      const electrolyzerCapex = electrolyzer.capacity * 1000 * electrolyzer.capex;
      const annualizedElectrolyzerCapex = electrolyzerCapex * crf;
      const totalAnnualizedCapex = totalPowerSourceCapex + annualizedElectrolyzerCapex;
      
      let totalPowerSourceOpex = 0;
      updatedSources.forEach(source => {
        const sourceOpex = source.capacity * 1000 * source.opex;
        totalPowerSourceOpex += sourceOpex;
      });
      
      const electrolyzerOpex = electrolyzer.capacity * 1000 * electrolyzer.opex;
      const totalAnnualOpex = totalPowerSourceOpex + electrolyzerOpex;
      
      let totalEnergyCost = 0;
      Object.entries(energyBySource).forEach(([type, energy]) => {
        const source = updatedSources.find(s => s.type === type);
        if (source && source.lcoe) {
          const sourceCost = energy * 1000 * source.lcoe;
          totalEnergyCost += sourceCost;
        }
      });
      
      const totalAnnualCost = totalAnnualizedCapex + totalAnnualOpex + totalEnergyCost;
      const lcoh = totalAnnualCost / annualH2Production;
      
      const energyMix = Object.entries(energyBySource).map(([type, energy]) => ({
        type,
        energy,
        percentage: (energy / totalEnergyUsed) * 100
      }));
      
      const costBreakdown = {
        capex: {
          amount: totalAnnualizedCapex,
          percentage: (totalAnnualizedCapex / totalAnnualCost) * 100
        },
        opex: {
          amount: totalAnnualOpex,
          percentage: (totalAnnualOpex / totalAnnualCost) * 100
        },
        energy: {
          amount: totalEnergyCost,
          percentage: (totalEnergyCost / totalAnnualCost) * 100
        }
      };
      
      const monthlyData = [];
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let hourIndex = 0;
      
      for (let month = 0; month < 12; month++) {
        const monthName = new Date(2023, month).toLocaleString('default', { month: 'short' });
        let totalEnergy = 0;
        let totalCurtailed = 0;
        const hoursInMonth = daysInMonth[month] * 24;
        
        for (let h = 0; h < hoursInMonth && hourIndex < hourlyDispatch.length; h++, hourIndex++) {
          totalEnergy += hourlyDispatch[hourIndex].energyUsed;
          totalCurtailed += hourlyDispatch[hourIndex].curtailedEnergy;
        }
        
        monthlyData.push({
          month: monthName,
          energy: totalEnergy,
          curtailed: totalCurtailed
        });
      }
      
      setResults({
        lcoh,
        totalAnnualCost,
        annualH2Production,
        costBreakdown,
        energyStats: {
          totalEnergyUsed,
          totalCurtailedEnergy,
          curtailmentPercentage: (totalCurtailedEnergy / (totalEnergyUsed + totalCurtailedEnergy)) * 100,
          utilizationRate: totalEnergyUsed / (electrolyzer.capacity * 8760)
        },
        energyMix,
        monthlyData,
        hourlyDispatch
      });
      
      setCalculating(false);
      setShowResults(true);
      setResultsCollapsed(false);
    }, 2000);
  };
  
  // Check if calculation can be performed
  const canCalculate = () => {
    for (const source of inputs.powerSources) {
      if (source.type !== 'grid') {
        if (!source.timeSeriesData && !source.lcoe) {
          return false;
        }
      }
    }
    return true;
  };
  
  // Handle form input changes
  const handleInputChange = (category, index, field, value) => {
    setInputs(prevInputs => {
      const newInputs = { ...prevInputs };
      
      if (category === 'powerSources') {
        newInputs.powerSources[index][field] = value;
        
        if (field === 'type') {
          const source = newInputs.powerSources[index];
          if (value === 'grid') {
            source.electricityPrice = 0.05;
            source.lcoe = 0.05;
            source.timeSeriesData = null;
          } else {
            source.electricityPrice = null;
            source.lcoe = null;
            source.timeSeriesData = null;
            if (!source.location) {
              source.location = { lat: 40, lng: -75 };
            }
            if (!source.year) {
              source.year = 2022;
            }
          }
        }
        
        if (field === 'electricityPrice' && newInputs.powerSources[index].type === 'grid') {
          newInputs.powerSources[index].lcoe = value;
        }
        
        if ((field === 'capex' || field === 'opex') && newInputs.powerSources[index].type !== 'grid') {
          if (newInputs.powerSources[index].timeSeriesData) {
            newInputs.powerSources[index].lcoe = calculateLCOE(
              newInputs.powerSources[index],
              newInputs.powerSources[index].timeSeriesData,
              newInputs.financial
            );
          } else {
            newInputs.powerSources[index].lcoe = null;
          }
        }
      } else if (category === 'electrolyzer') {
        newInputs.electrolyzer[field] = value;
      } else if (category === 'financial') {
        newInputs.financial[field] = value;
        
        if (field === 'returnRate' || field === 'lifetime') {
          newInputs.powerSources.forEach((source, idx) => {
            if (source.type !== 'grid' && source.timeSeriesData) {
              source.lcoe = calculateLCOE(source, source.timeSeriesData, newInputs.financial);
            }
          });
        }
      } else if (category === 'apis') {
        newInputs.apis[field] = value;
      }
      
      return newInputs;
    });
  };
  
  // Add a power source
  const addPowerSource = (type = 'grid') => {
    setInputs(prevInputs => {
      const newSource = {
        type,
        capacity: 100,
        capex: type === 'grid' ? 0 : 1000,
        opex: type === 'grid' ? 80 : 20,
        electricityPrice: type === 'grid' ? 0.05 : null,
        lcoe: type === 'grid' ? 0.05 : null,
        timeSeriesData: null
      };
      
      if (type !== 'grid') {
        newSource.location = { lat: 40, lng: -75 };
        newSource.year = 2022;
      }
      
      return {
        ...prevInputs,
        powerSources: [...prevInputs.powerSources, newSource]
      };
    });
    
    setSelectedPowerSource(inputs.powerSources.length);
  };
  
  // Remove a power source
  const removePowerSource = (index) => {
    if (inputs.powerSources.length <= 1) return;
    
    setInputs(prevInputs => {
      const newSources = [...prevInputs.powerSources];
      newSources.splice(index, 1);
      
      return {
        ...prevInputs,
        powerSources: newSources
      };
    });
    
    if (selectedPowerSource >= inputs.powerSources.length - 1) {
      setSelectedPowerSource(inputs.powerSources.length - 2);
    }
  };
  
  // Handle location change from map click
  const handleMapLocationChange = (lat, lng) => {
    setInputs(prevInputs => {
      const newInputs = { ...prevInputs };
      newInputs.powerSources[selectedPowerSource].location = { lat, lng };
      newInputs.powerSources[selectedPowerSource].timeSeriesData = null;
      newInputs.powerSources[selectedPowerSource].lcoe = null;
      return newInputs;
    });
    
    // Immediately update the marker position
    setMarkerPositions(prev => ({
      ...prev,
      [selectedPowerSource]: [lat, lng]
    }));
  };

  // Colors for charts
  const SOURCE_COLORS = {
    solar: '#FFD700',
    wind: '#82CA9D',
    grid: '#8884D8'
  };
  
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  // Map click handler component
  const MapClickHandler = () => {
    // Set up map event handler for clicks
    useMapEvents({
      click: (e) => {
        const { lat, lng } = e.latlng;
        
        // Only update if the selected source is not grid
        if (inputs.powerSources[selectedPowerSource].type !== 'grid') {
          handleMapLocationChange(lat, lng);
        }
      },
    });
    
    return null;
  };
  
  // Map controller component
  const MapController = () => {
    const map = useMap();
    mapRef.current = map;
    
    // Update map view based on selected power source
    useEffect(() => {
      const source = inputs.powerSources[selectedPowerSource];
      if (source && source.type !== 'grid' && source.location) {
        map.setView([source.location.lat, source.location.lng], 7, { animate: true });
      }
    }, [selectedPowerSource, map]);
    
    return null;
  };

  // Custom marker icon based on source type
  const getMarkerIcon = (type) => {
    const color = SOURCE_COLORS[type] || '#8884D8';
    
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white;"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  };

  const renderInputsPanel = () => (
    <div className="inputs-panel">
      <div className="panel-header">
        <h2 className="panel-title">Parameter input dashboard</h2>
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="theme-toggle-btn"
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>
      
      {/* Power Sources Section */}
      <div className={`section ${expandedSections.powerSources ? 'expanded' : ''}`}>
        <div className="section-header" onClick={() => toggleSection('powerSources')}>
          <h3 className="section-title">Power Sources</h3>
          <span className="toggle-icon">{expandedSections.powerSources ? '▼' : '►'}</span>
        </div>
        
        {expandedSections.powerSources && (
          <div className="section-content">
            <div className="power-sources-list">
              {inputs.powerSources.map((source, index) => (
                <div
                  key={index}
                  className={`power-source-item ${selectedPowerSource === index ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedPowerSource(index);
                    // If not grid, center map on this source
                    if (source.type !== 'grid' && source.location && mapRef.current) {
                      mapRef.current.setView([source.location.lat, source.location.lng], 7, { animate: true });
                    }
                  }}
                >
                  <div className="flex items-center">
                    <span 
                      className="power-source-icon" 
                      style={{ backgroundColor: SOURCE_COLORS[source.type] }}
                    ></span>
                    <span className="power-source-name">{source.type.charAt(0).toUpperCase() + source.type.slice(1)}</span>
                    <span className="power-source-capacity">{source.capacity} MW</span>
                  </div>
                  {source.type !== 'grid' && (
                    <div className="power-source-lcoe">
                      {source.lcoe 
                        ? <span className="lcoe-value">LCOE: ${source.lcoe.toFixed(4)}/kWh</span>
                        : <span className="lcoe-missing">No LCOE calculated</span>
                      }
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="source-buttons">
              <button onClick={() => addPowerSource('solar')} className="add-btn solar">
                + Solar
              </button>
              <button onClick={() => addPowerSource('wind')} className="add-btn wind">
                + Wind
              </button>
              <button onClick={() => addPowerSource('grid')} className="add-btn grid">
                + Grid
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Source Details Section */}
      <div className={`section ${expandedSections.sourceDetails ? 'expanded' : ''}`}>
        <div className="section-header" onClick={() => toggleSection('sourceDetails')}>
          <h3 className="section-title">
            <span 
              className="power-source-icon" 
              style={{ backgroundColor: SOURCE_COLORS[inputs.powerSources[selectedPowerSource].type] }}
            ></span>
            {inputs.powerSources[selectedPowerSource].type.charAt(0).toUpperCase() + 
             inputs.powerSources[selectedPowerSource].type.slice(1)} Source Details
          </h3>
          <div className="section-actions">
            {inputs.powerSources.length > 1 && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  removePowerSource(selectedPowerSource);
                }}
                className="remove-btn"
              >
                Remove
              </button>
            )}
            <span className="toggle-icon">{expandedSections.sourceDetails ? '▼' : '►'}</span>
          </div>
        </div>
        
        {expandedSections.sourceDetails && (
          <div className="section-content">
            <div className="form-grid">
              <div className="form-group">
                <label>Type</label>
                <select
                  value={inputs.powerSources[selectedPowerSource].type}
                  onChange={(e) => handleInputChange('powerSources', selectedPowerSource, 'type', e.target.value)}
                >
                  <option value="solar">Solar PV</option>
                  <option value="wind">Wind</option>
                  <option value="grid">Grid</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Capacity (MW)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={inputs.powerSources[selectedPowerSource].capacity}
                  onChange={(e) => handleInputChange('powerSources', selectedPowerSource, 'capacity', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>CAPEX ($/kW)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={inputs.powerSources[selectedPowerSource].capex}
                  onChange={(e) => handleInputChange('powerSources', selectedPowerSource, 'capex', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>OPEX ($/kW/year)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={inputs.powerSources[selectedPowerSource].opex}
                  onChange={(e) => handleInputChange('powerSources', selectedPowerSource, 'opex', parseFloat(e.target.value))}
                />
              </div>
              
              {inputs.powerSources[selectedPowerSource].type === 'grid' ? (
                <div className="form-group col-span-2">
                  <label>Electricity Price ($/kWh)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={inputs.powerSources[selectedPowerSource].electricityPrice}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      handleInputChange('powerSources', selectedPowerSource, 'electricityPrice', value);
                      handleInputChange('powerSources', selectedPowerSource, 'lcoe', value);
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="form-group col-span-2">
                    <label>Location (Lat, Lng)</label>
                    <div className="location-inputs">
                      <input
                        type="number"
                        min="-90"
                        max="90"
                        step="0.01"
                        value={inputs.powerSources[selectedPowerSource].location?.lat || 0}
                        onChange={(e) => {
                          const lat = parseFloat(e.target.value);
                          handleMapLocationChange(lat, inputs.powerSources[selectedPowerSource].location?.lng || 0);
                        }}
                      />
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        step="0.01"
                        value={inputs.powerSources[selectedPowerSource].location?.lng || 0}
                        onChange={(e) => {
                          const lng = parseFloat(e.target.value);
                          handleMapLocationChange(inputs.powerSources[selectedPowerSource].location?.lat || 0, lng);
                        }}
                      />
                    </div>
                    <p className="location-help-text">
                      Click on map to set location, or enter coordinates above
                    </p>
                  </div>
                
                  <div className="form-group">
                    <label>Data Year</label>
                    <input
                      type="number"
                      min="2010"
                      max="2023"
                      step="1"
                      value={inputs.powerSources[selectedPowerSource].year || 2022}
                      onChange={(e) => handleInputChange('powerSources', selectedPowerSource, 'year', parseInt(e.target.value))}
                    />
                  </div>

                  <div className="form-group col-span-2">
                    <label>Generation Profile</label>
                    <div className="generation-profile-inputs">
                      {inputs.powerSources[selectedPowerSource].type === 'wind' && (
                        <input
                          type="text"
                          value={inputs.apis.renewableNinjaToken}
                          onChange={(e) => handleInputChange('apis', 0, 'renewableNinjaToken', e.target.value)}
                          placeholder="Renewable Ninja API Token"
                        />
                      )}
                      
                      <button
                        onClick={() => {
                          if (inputs.powerSources[selectedPowerSource].type === 'solar') {
                            fetchPVGISData(selectedPowerSource);
                          } else if (inputs.powerSources[selectedPowerSource].type === 'wind') {
                            fetchRenewableNinjaData(selectedPowerSource);
                          }
                        }}
                        disabled={isDownloading || (
                          inputs.powerSources[selectedPowerSource].type === 'wind' && 
                          (!inputs.apis.renewableNinjaToken || inputs.apis.renewableNinjaToken.trim() === "")
                        )}
                        className="download-btn"
                      >
                        {isDownloading ? 'Downloading...' : `Download Data`}
                      </button>
                    </div>
                    
                    {inputs.powerSources[selectedPowerSource].timeSeriesData ? (
                      <div className="data-status">
                        <div className="data-loaded">✓ 8760h data loaded</div>
                        {inputs.powerSources[selectedPowerSource].lcoe && (
                          <div className="lcoe-calculated">
                            LCOE: ${inputs.powerSources[selectedPowerSource].lcoe.toFixed(4)}/kWh
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="data-missing">✗ No generation profile</div>
                    )}
                    
                    {apiError && (
                      <div className="api-error">{apiError}</div>
                    )}
                  </div>
                </>
              )}
              
              {inputs.powerSources[selectedPowerSource].type !== 'grid' && 
               inputs.powerSources[selectedPowerSource].timeSeriesData && (
                <div className="form-group col-span-2">
                  <label>Daily Profile Preview</label>
                  <div className="day-selectors">
                    <select
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                    >
                      {[...Array(12)].map((_, i) => (
                        <option key={i+1} value={i+1}>
                          {new Date(2022, i, 1).toLocaleString('default', { month: 'long' })}
                        </option>
                      ))}
                    </select>
                    
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(parseInt(e.target.value))}
                    >
                      {[...Array(getDaysInMonth(selectedMonth))].map((_, i) => (
                        <option key={i+1} value={i+1}>{i+1}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="daily-profile-chart" key={`${selectedMonth}-${selectedDay}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={getSelectedDayData(inputs.powerSources[selectedPowerSource].timeSeriesData)}
                        margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#555" />
                        <XAxis 
                          dataKey="hour"
                          stroke="#aaa"
                          tick={{ fill: '#aaa' }}
                        />
                        <YAxis 
                          domain={[0, 1]}
                          tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                          stroke="#aaa"
                          tick={{ fill: '#aaa' }}
                        />
                        <Tooltip 
                          formatter={(value) => [`${(value * 100).toFixed(1)}%`, 'Capacity Factor']}
                          labelFormatter={(hour) => `Hour ${hour}:00`}
                          contentStyle={{ backgroundColor: '#333', borderColor: '#555', borderRadius: '10px' }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={SOURCE_COLORS[inputs.powerSources[selectedPowerSource].type]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Electrolyzer Configuration Section */}
      <div className={`section ${expandedSections.electrolyzer ? 'expanded' : ''}`}>
        <div className="section-header" onClick={() => toggleSection('electrolyzer')}>
          <h3 className="section-title">Electrolyzer Configuration</h3>
          <span className="toggle-icon">{expandedSections.electrolyzer ? '▼' : '►'}</span>
        </div>
        
        {expandedSections.electrolyzer && (
          <div className="section-content">
            <div className="form-grid">
              <div className="form-group">
                <label>Capacity (MW)</label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={inputs.electrolyzer.capacity}
                  onChange={(e) => handleInputChange('electrolyzer', 0, 'capacity', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>Efficiency (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={inputs.electrolyzer.efficiency}
                  onChange={(e) => handleInputChange('electrolyzer', 0, 'efficiency', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>CAPEX ($/kW)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={inputs.electrolyzer.capex}
                  onChange={(e) => handleInputChange('electrolyzer', 0, 'capex', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>OPEX ($/kW/year)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={inputs.electrolyzer.opex}
                  onChange={(e) => handleInputChange('electrolyzer', 0, 'opex', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group col-span-2">
                <label>Base Energy Consumption (kWh/kg H₂ at 100% efficiency)</label>
                <input
                  type="number"
                  min="33"
                  step="0.1"
                  value={inputs.electrolyzer.baseConsumption}
                  onChange={(e) => handleInputChange('electrolyzer', 0, 'baseConsumption', parseFloat(e.target.value))}
                />
                <p className="help-text">Theoretical minimum is ~33 kWh/kg</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Financial Parameters Section */}
      <div className={`section ${expandedSections.financial ? 'expanded' : ''}`}>
        <div className="section-header" onClick={() => toggleSection('financial')}>
          <h3 className="section-title">Financial Parameters</h3>
          <span className="toggle-icon">{expandedSections.financial ? '▼' : '►'}</span>
        </div>
        
        {expandedSections.financial && (
          <div className="section-content">
            <div className="form-grid">
              <div className="form-group">
                <label>Return Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={inputs.financial.returnRate}
                  onChange={(e) => handleInputChange('financial', 0, 'returnRate', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group">
                <label>System Lifetime (years)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={inputs.financial.lifetime}
                  onChange={(e) => handleInputChange('financial', 0, 'lifetime', parseFloat(e.target.value))}
                />
              </div>
              
              <div className="form-group col-span-2">
                <label>Default Capacity Factor (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={inputs.financial.capacityFactor}
                  onChange={(e) => handleInputChange('financial', 0, 'capacityFactor', parseFloat(e.target.value))}
                />
                <p className="help-text">Used when no generation profile data is available</p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className="calculate-container">
        <button
          onClick={calculateLCOH}
          disabled={calculating || !canCalculate()}
          className="calculate-btn"
        >
          {calculating ? (
            <span className="calculating">
              <svg className="spinner" viewBox="0 0 50 50">
                <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
              </svg>
              Calculating...
            </span>
          ) : 'Calculate LCOH'}
        </button>
        
        {!canCalculate() && (
          <div className="calculate-warning">
            Download generation profiles for all renewable sources first
          </div>
        )}
      </div>
    </div>
  );
  
  const renderResultsPanel = () => {
    if (!results) {
      return null;
    }
    
    // Format LCOH value
    const formatLCOH = (value) => {
      if (value < 0.1) return value.toFixed(4);
      if (value < 1) return value.toFixed(3);
      if (value < 10) return value.toFixed(2);
      return value.toFixed(1);
    };
    
    // Prepare cost breakdown data
    const costBreakdownData = [
      { name: 'CAPEX', value: results.costBreakdown.capex.percentage },
      { name: 'OPEX', value: results.costBreakdown.opex.percentage },
      { name: 'Energy', value: results.costBreakdown.energy.percentage }
    ];
    
    // Prepare energy mix data
    const energyMixData = results.energyMix.map(source => ({
      name: source.type.charAt(0).toUpperCase() + source.type.slice(1),
      value: source.percentage
    }));
    
    // Prepare LCOE comparison data
    const lcoeComparisonData = inputs.powerSources
      .filter(source => source.lcoe !== null)
      .map(source => ({
        name: source.type.charAt(0).toUpperCase() + source.type.slice(1),
        lcoe: source.lcoe
      }))
      .sort((a, b) => a.lcoe - b.lcoe);
    
    return (
      <div className={`results-panel ${resultsCollapsed ? 'collapsed' : ''}`}>
        <div className="results-header">
          <h2 className="panel-title">Results dashboard</h2>
          <div className="results-actions">
            <button
              onClick={() => setResultsCollapsed(!resultsCollapsed)}
              className="collapse-btn"
              aria-label={resultsCollapsed ? 'Expand results' : 'Collapse results'}
            >
              {resultsCollapsed ? '◀' : '▶'}
            </button>
          </div>
        </div>
        
        {!resultsCollapsed && (
          <>
            <div className="results-summary">
              <div className="result-card lcoh">
                <h3>LCOH</h3>
                <div className="value">${formatLCOH(results.lcoh)}/kg</div>
                <div className="subtitle">Levelized Cost of Hydrogen</div>
              </div>
              
              <div className="result-card h2">
                <h3>H₂ Production</h3>
                <div className="value">
                  {(results.annualH2Production / 1000).toFixed(1)}
                  <span className="unit">tonnes/year</span>
                </div>
                <div className="subtitle">
                  {results.annualH2Production.toLocaleString(undefined, {maximumFractionDigits: 0})} kg/year
                </div>
              </div>
              
              <div className="result-card curtailment">
                <h3>Energy Curtailment</h3>
                <div className="value">{results.energyStats.curtailmentPercentage.toFixed(1)}%</div>
                <div className="subtitle">
                  {results.energyStats.totalCurtailedEnergy.toFixed(0)} MWh curtailed
                </div>
              </div>
            </div>
            
            <div className="results-grid">
              <div className="chart-container">
                <h3>Cost Breakdown</h3>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={costBreakdownData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => 
                          `${name}: ${(percent * 100).toFixed(0)}%`
                        }
                        outerRadius={70}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {costBreakdownData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value) => `${value.toFixed(1)}%`} 
                        contentStyle={{ backgroundColor: '#333', borderColor: '#555', borderRadius: '10px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="cost-details">
                  <div className="cost-item" style={{ backgroundColor: 'rgba(0,136,254,0.2)' }}>
                    <span>CAPEX</span>
                    <span>${results.costBreakdown.capex.amount.toLocaleString(undefined, {maximumFractionDigits: 0})}/yr</span>
                  </div>
                  <div className="cost-item" style={{ backgroundColor: 'rgba(0,196,159,0.2)' }}>
                    <span>OPEX</span>
                    <span>${results.costBreakdown.opex.amount.toLocaleString(undefined, {maximumFractionDigits: 0})}/yr</span>
                  </div>
                  <div className="cost-item" style={{ backgroundColor: 'rgba(255,187,40,0.2)' }}>
                    <span>Energy</span>
                    <span>${results.costBreakdown.energy.amount.toLocaleString(undefined, {maximumFractionDigits: 0})}/yr</span>
                  </div>
                </div>
              </div>
              
              <div className="chart-container">
                <h3>Energy Mix</h3>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={energyMixData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => 
                          `${name}: ${(percent * 100).toFixed(0)}%`
                        }
                        outerRadius={70}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {energyMixData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={SOURCE_COLORS[entry.name.toLowerCase()] || COLORS[index % COLORS.length]} 
                          />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value) => `${value.toFixed(1)}%`} 
                        contentStyle={{ backgroundColor: '#333', borderColor: '#555', borderRadius: '10px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="energy-total">
                  Total energy used: {results.energyStats.totalEnergyUsed.toLocaleString(undefined, {maximumFractionDigits: 0})} MWh/year
                </div>
              </div>
              
              <div className="chart-container">
                <h3>LCOE Comparison</h3>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={lcoeComparisonData}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#555" />
                      <XAxis dataKey="name" stroke="#aaa" tick={{ fill: '#aaa' }} />
                      <YAxis 
                        tickFormatter={(value) => value.toFixed(2)}
                        stroke="#aaa"
                        tick={{ fill: '#aaa' }}
                      />
                      <Tooltip 
                        formatter={(value) => `$${value.toFixed(4)}/kWh`} 
                        contentStyle={{ backgroundColor: '#333', borderColor: '#555', borderRadius: '10px' }}
                      />
                      <Bar dataKey="lcoe" name="LCOE ($/kWh)">
                        {lcoeComparisonData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={SOURCE_COLORS[entry.name.toLowerCase()] || COLORS[index % COLORS.length]} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
              <div className="chart-container">
                <h3>Monthly Energy Profile</h3>
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={results.monthlyData}
                      margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#555" />
                      <XAxis dataKey="month" stroke="#aaa" tick={{ fill: '#aaa' }} />
                      <YAxis stroke="#aaa" tick={{ fill: '#aaa' }} />
                      <Tooltip 
                        formatter={(value) => `${value.toFixed(0)} MWh`} 
                        contentStyle={{ backgroundColor: '#333', borderColor: '#555', borderRadius: '10px' }}
                      />
                      <Legend />
                      <Bar dataKey="energy" name="Energy Used" fill="#82ca9d" />
                      <Bar dataKey="curtailed" name="Energy Curtailed" fill="#ffc658" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            
            <div className="results-footer">
              <div className="utilizationRate">
                <h3>System Utilization</h3>
                <div className="value">{(results.energyStats.utilizationRate * 100).toFixed(1)}%</div>
                <div className="subtitle">Annual average capacity factor</div>
              </div>
              
              <div className="totalCost">
                <h3>Total Annual Cost</h3>
                <div className="value">${(results.totalAnnualCost / 1000000).toFixed(2)}M</div>
                <div className="subtitle">${results.totalAnnualCost.toLocaleString(undefined, {maximumFractionDigits: 0})}/year</div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`lcoh-calculator ${darkMode ? 'dark-mode' : 'light-mode'}`}>
      <style jsx="true">{`
        .lcoh-calculator {
          position: relative;
          width: 100%;
          height: 100vh;
          font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: hidden;
          color: white;
        }
        
        .map-container {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
        }
        
        .inputs-panel {
          position: absolute;
          top: 0;
          left: 0;
          width: 600px;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.85);
          color: white;
          z-index: 10;
          overflow-y: scroll;
          padding: 20px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          box-sizing: border-box;
        }
        
        .results-panel {
          position: fixed;
          top: 0;
          left: 600px;
          width: 600px;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.85);
          color: white;
          z-index: 10;
          overflow-y: scroll;
          padding: 20px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: width 0.3s ease, transform 0.3s ease;
          box-sizing: border-box;
        }
        
        .results-panel.collapsed {
          width: 50px;
          padding: 20px 0;
          overflow: hidden;
          left: auto;
          right: 0;
        }
        
        .results-panel.collapsed .results-header {
          transform: rotate(90deg);
          transform-origin: left center;
          white-space: nowrap;
          width: 100vh;
          margin-left: 25px;
          padding-left: 20px;
        }
        
        .results-panel.collapsed .collapse-btn {
          transform: rotate(-90deg);
        }
        
        .panel-header, 
        .results-header, 
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 10px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .panel-title,
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: white;
          margin: 0;
        }
        
        .theme-toggle-btn,
        .collapse-btn {
          background: none;
          border: none;
          color: white;
          font-size: 16px;
          cursor: pointer;
          padding: 5px;
          border-radius: 50%;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s ease;
        }
        
        .theme-toggle-btn:hover,
        .collapse-btn:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }
        
        .section {
          margin-bottom: 20px;
          border-radius: 16px;
          background-color: rgba(30, 30, 30, 0.7);
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .section.expanded {
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        
        .section-header {
          padding: 15px 20px;
          cursor: pointer;
          margin-bottom: 0;
          border-bottom: none;
          transition: background-color 0.2s ease;
        }
        
        .section-header:hover {
          background-color: rgba(60, 60, 60, 0.5);
        }
        
        .section-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .results-actions {
          display: flex;
          align-items: center;
        }
        
        .toggle-icon {
          font-size: 12px;
          transition: transform 0.3s ease;
        }
        
        .section-content {
          padding: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .power-sources-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 15px;
        }
        
        .power-source-item {
          padding: 12px 15px;
          background-color: rgba(60, 60, 60, 0.5);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .power-source-item:hover {
          background-color: rgba(80, 80, 80, 0.5);
        }
        
        .power-source-item.selected {
          background-color: rgba(0, 122, 255, 0.2);
          border-left: 3px solid #007AFF;
        }
        
        .power-source-item .flex {
          display: flex;
          align-items: center;
        }
        
        .power-source-icon {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          margin-right: 8px;
        }
        
        .power-source-name {
          font-weight: 500;
        }
        
        .power-source-capacity {
          margin-left: auto;
          font-size: 14px;
          opacity: 0.7;
        }
        
        .power-source-lcoe {
          margin-top: 6px;
          font-size: 12px;
        }
        
        .lcoe-value {
          color: #34C759;
        }
        
        .lcoe-missing {
          color: #FF3B30;
        }
        
        .source-buttons {
          display: flex;
          gap: 10px;
          margin-top: 15px;
        }
        
        .add-btn {
          padding: 8px 12px;
          border-radius: 8px;
          border: none;
          color: white;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.2s ease;
        }
        
        .add-btn:hover {
          opacity: 0.8;
        }
        
        .add-btn.solar {
          background-color: #FFD700;
          color: black;
        }
        
        .add-btn.wind {
          background-color: #82CA9D;
          color: black;
        }
        
        .add-btn.grid {
          background-color: #8884D8;
        }
        
        .remove-btn {
          padding: 6px 10px;
          background-color: #FF3B30;
          border-radius: 8px;
          border: none;
          color: white;
          font-size: 12px;
          cursor: pointer;
          transition: opacity 0.2s ease;
        }
        
        .remove-btn:hover {
          opacity: 0.8;
        }
        
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          width: 100%;
        }
        
        .form-group {
          margin-bottom: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        
        .form-group.col-span-2 {
          grid-column: span 2;
        }
        
        .form-group label {
          display: block;
          font-size: 13px;
          margin-bottom: 6px;
          color: rgba(255, 255, 255, 0.7);
        }
        
        .form-group input, 
        .form-group select {
          width: 100%;
          padding: 10px;
          background-color: rgba(60, 60, 60, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: white;
          font-size: 14px;
        }
        
        .form-group input:focus, 
        .form-group select:focus {
          outline: none;
          border-color: #007AFF;
          box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.3);
        }
        
        .location-inputs {
          display: flex;
          gap: 10px;
        }
        
        .location-help-text {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 6px;
        }
        
        .generation-profile-inputs {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
        }
        
        .download-btn {
          padding: 10px 15px;
          background-color: #007AFF;
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s ease;
          white-space: nowrap;
        }
        
        .download-btn:hover {
          background-color: #0062CC;
        }
        
        .download-btn:disabled {
          background-color: rgba(0, 122, 255, 0.3);
          cursor: not-allowed;
        }
        
        .data-status {
          margin-top: 10px;
          padding: 10px;
          border-radius: 8px;
          background-color: rgba(52, 199, 89, 0.1);
        }
        
        .data-loaded {
          color: #34C759;
          font-weight: 500;
        }
        
        .lcoe-calculated {
          color: #34C759;
          margin-top: 5px;
          font-size: 13px;
        }
        
        .data-missing {
          margin-top: 10px;
          padding: 10px;
          border-radius: 8px;
          background-color: rgba(255, 59, 48, 0.1);
          color: #FF3B30;
          font-weight: 500;
        }
        
        .api-error {
          margin-top: 10px;
          padding: 10px;
          border-radius: 8px;
          background-color: rgba(255, 59, 48, 0.1);
          color: #FF3B30;
          font-size: 13px;
        }
        
        .day-selectors {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
        }
        
        .daily-profile-chart {
          height: 200px;
          background-color: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          padding: 10px;
          overflow: hidden;
        }
        
        .help-text {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 6px;
        }
        
        .calculate-container {
          margin-top: 30px;
          text-align: center;
        }
        
        .calculate-btn {
          padding: 12px 30px;
          background-color: #007AFF;
          border: none;
          border-radius: 12px;
          color: white;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(0, 122, 255, 0.4);
        }
        
        .calculate-btn:hover {
          background-color: #0062CC;
          transform: translateY(-2px);
        }
        
        .calculate-btn:active {
          transform: translateY(0);
        }
        
        .calculate-btn:disabled {
          background-color: rgba(0, 122, 255, 0.3);
          cursor: not-allowed;
          box-shadow: none;
        }
        
        .calculating {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .spinner {
          animation: rotate 2s linear infinite;
          width: 20px;
          height: 20px;
          margin-right: 10px;
        }
        
        .path {
          stroke: white;
          stroke-linecap: round;
          animation: dash 1.5s ease-in-out infinite;
        }
        
        @keyframes rotate {
          100% {
            transform: rotate(360deg);
          }
        }
        
        @keyframes dash {
          0% {
            stroke-dasharray: 1, 150;
            stroke-dashoffset: 0;
          }
          50% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -35;
          }
          100% {
            stroke-dasharray: 90, 150;
            stroke-dashoffset: -124;
          }
        }
        
        .calculate-warning {
          margin-top: 10px;
          color: #FF3B30;
          font-size: 13px;
        }
        
        .results-summary {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 25px;
        }
        
        .result-card {
          padding: 15px;
          border-radius: 12px;
          text-align: center;
        }
        
        .result-card h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 10px 0;
          opacity: 0.9;
        }
        
        .result-card .value {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 5px;
        }
        
        .result-card .unit {
          font-size: 16px;
          font-weight: normal;
        }
        
        .result-card .subtitle {
          font-size: 12px;
          opacity: 0.6;
        }
        
        .result-card.lcoh {
          background-color: rgba(0, 122, 255, 0.2);
        }
        
        .result-card.h2 {
          background-color: rgba(52, 199, 89, 0.2);
        }
        
        .result-card.curtailment {
          background-color: rgba(175, 82, 222, 0.2);
        }
        
        .results-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        
        .chart-container {
          background-color: rgba(30, 30, 30, 0.7);
          border-radius: 12px;
          padding: 15px;
          margin-bottom: 20px;
        }
        
        .chart-container h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 15px 0;
          text-align: center;
        }
        
        .chart {
          height: 200px;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .cost-details {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 15px;
        }
        
        .cost-item {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
        }
        
        .energy-total {
          text-align: center;
          margin-top: 15px;
          font-size: 14px;
          opacity: 0.7;
        }
        
        .results-footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-top: 10px;
        }
        
        .utilizationRate,
        .totalCost {
          padding: 15px;
          border-radius: 12px;
          text-align: center;
          background-color: rgba(30, 30, 30, 0.7);
        }
        
        .utilizationRate h3,
        .totalCost h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 10px 0;
          opacity: 0.9;
        }
        
        .utilizationRate .value,
        .totalCost .value {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 5px;
        }
        
        .utilizationRate .subtitle,
        .totalCost .subtitle {
          font-size: 12px;
          opacity: 0.6;
        }
        
        /* Custom marker styling */
        .custom-marker {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        
        /* For touch devices, make inputs more touch-friendly */
        @media (max-width: 1200px) {
          .inputs-panel {
            width: 400px;
          }
          
          .results-panel {
            left: 400px;
            width: 500px;
          }
          
          .form-group input, 
          .form-group select {
            padding: 12px;
          }
          
          .add-btn, 
          .remove-btn {
            padding: 10px 15px;
          }
        }
        
        @media (max-width: 900px) {
          .inputs-panel {
            width: 100%;
            z-index: 20;
          }
          
          .results-panel {
            left: 0;
            width: 100%;
            z-index: 15;
          }
        }
      `}</style>
      
      <div className="map-container">
        <MapContainer 
          center={mapCenter} 
          zoom={mapZoom} 
          style={{ height: '100%', width: '100%' }}
          whenCreated={(map) => {
            mapRef.current = map;
            map.on('zoom', () => {
              setMapZoom(map.getZoom());
            });
          }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler />
          <MapController />
          
          {/* Create a marker for each power source with location */}
          {inputs.powerSources.map((source, index) => {
            if (source.type === 'grid' || !source.location) return null;
            
            return (
              <Marker 
                key={`marker-${index}`}
                position={[source.location.lat, source.location.lng]}
                icon={getMarkerIcon(source.type)}
                eventHandlers={{
                  click: () => {
                    setSelectedPowerSource(index);
                  }
                }}
              />
            );
          })}
        </MapContainer>
      </div>
      
      {renderInputsPanel()}
      
      {showResults && renderResultsPanel()}
    </div>
  );
};

export default App;