import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log("Mapbox GL JS Loaded:", mapboxgl);
// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoicGV0ZXItc2hhbW91bjA1IiwiYSI6ImNtN2p1eGt0OTBiYmUybXBzZzJ0MDFpMjQifQ.Pk0CpPoRjohsSCa3DOPcMQ';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

// Define a common style for bike lanes
const bikeLaneStyle = {
  'line-color': '#32D400',  // Bright green
  'line-width': 3,
  'line-opacity': 0.6
};

// Helper function to convert station coordinates to pixel positions
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point);  // Project to pixel coordinates
  return { cx: x, cy: y };  // Return as object for use in SVG attributes
}

// Helper function to format time (minutes since midnight) as HH:MM AM/PM
function formatTime(minutes) {
  const date = new Date(0, 0, 0, Math.floor(minutes / 60), minutes % 60);  // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper function to get minutes since midnight from a Date object
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Pre-sort trips into minute buckets for efficient filtering
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Function to filter trips by minute efficiently
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute + 1);
    return [...beforeMidnight, ...afterMidnight].flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute + 1).flat();
  }
}

// Function to compute station traffic based on filtered trips
function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with filtered counts
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Wait for the map to load before adding data
map.on('load', async () => {
  // Add Boston bike lane data
  map.addSource('boston_bike_lanes', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_bike_lanes',
    paint: bikeLaneStyle
  });

  // Add Cambridge bike lane data
  map.addSource('cambridge_bike_lanes', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Trans/Bike_Facilities/TRANS_BikeFacilities.geojson'
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_bike_lanes',
    paint: bikeLaneStyle
  });

  // Fetch and display bike station data
  let jsonData;
  try {
    // Load the Bluebikes station data
    jsonData = await d3.json('bluebikes-stations.json');
    console.log('Loaded JSON Data:', jsonData); // Log to verify structure
    
    // Extract the stations array from the JSON data
    let stationsData = jsonData.data.stations;
    console.log('Stations Array:', stationsData);
    
    // Load the traffic data with date parsing
    const trips = await d3.csv('bluebikes-traffic-2024-03.csv', (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      
      // Pre-sort trips into minute buckets
      const startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);
      
      const endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);
      
      return trip;
    });
    console.log('Loaded Traffic Data:', trips.slice(0, 5)); // Log first 5 entries to verify structure
    
    // Compute initial station traffic (no filtering)
    const stations = computeStationTraffic(stationsData);
    
    // Create a square root scale for circle radius based on traffic
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([3, 25]); // Minimum radius of 3 to ensure all stations are visible
    
    // Create a quantize scale for traffic flow (departures to total traffic ratio)
    const stationFlow = d3.scaleQuantize()
      .domain([0, 1])
      .range([0, 0.5, 1]);
    
    // Select the SVG element inside the map container
    const svg = d3.select('#map').select('svg');
    
    // Create a tooltip div that is hidden by default
    const tooltip = d3.select("body").append("div")
      .attr("class", "tooltip")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background-color", "white")
      .style("border", "1px solid #ddd")
      .style("border-radius", "4px")
      .style("padding", "10px")
      .style("pointer-events", "none")
      .style("z-index", 1000);
    
    // Append circles to the SVG for each station
    const circles = svg.selectAll('circle')
      .data(stations, (d) => d.short_name) // Use station short_name as the key
      .enter()
      .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic)) // Size based on traffic
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8);
      
    // Add tooltips to circles using both title and interactive tooltip
    circles.each(function(d) {
      // Add <title> for browser tooltips (fallback)
      d3.select(this)
        .append('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    })
    .on("mouseover", function(event, d) {
      // Highlight the circle
      d3.select(this)
        .attr("stroke", "#ff9900")
        .attr("stroke-width", 2);
        
      // Show tooltip
      tooltip.transition()
        .duration(200)
        .style("opacity", 0.9);
        
      // Set tooltip content and position
      tooltip.html(`
        <strong>${d.name || 'Station'}</strong><br/>
        <strong>Total Traffic:</strong> ${d.totalTraffic} trips<br/>
        <strong>Departures:</strong> ${d.departures} (${Math.round(d.departures/d.totalTraffic*100)}%)<br/>
        <strong>Arrivals:</strong> ${d.arrivals} (${Math.round(d.arrivals/d.totalTraffic*100)}%)
      `)
      .style("left", (event.pageX + 10) + "px")
      .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseout", function() {
      // Reset circle style
      d3.select(this)
        .attr("stroke", "white")
        .attr("stroke-width", 1);
        
      // Hide tooltip
      tooltip.transition()
        .duration(500)
        .style("opacity", 0);
    });
    
    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
      circles
        .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
    }
    
    // Initial position update when map loads
    updatePositions();
    
    // Reposition markers on map interactions
    map.on('move', updatePositions);     // Update during map movement
    map.on('zoom', updatePositions);     // Update during zooming
    map.on('resize', updatePositions);   // Update on window resize
    map.on('moveend', updatePositions);  // Final adjustment after movement ends
    
    // Get DOM elements for time filtering
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');
    
    // Function to update the scatterplot based on time filter
    function updateScatterPlot(timeFilter) {
      // Adjust the radius scale based on filtering
      timeFilter === -1 
        ? radiusScale.range([3, 25]) 
        : radiusScale.range([3, 50]);
      
      // Recompute station traffic based on the filtered trips
      const filteredStations = computeStationTraffic(stationsData, timeFilter);
      
      // Update the scatterplot by adjusting the radius of circles
      svg.selectAll('circle')
        .data(filteredStations, (d) => d.short_name) // Use station short_name as the key
        .join('circle') // Ensure the data is bound correctly
        .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
        .style('--departure-ratio', (d) => 
          stationFlow(d.departures / d.totalTraffic)
        )
        .each(function(d) {
          // Update tooltip text
          d3.select(this).select('title')
            .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });
    }
    
    // Function to update time display and filter data
    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);  // Get slider value

      if (timeFilter === -1) {
        selectedTime.textContent = '';  // Clear time display
        anyTimeLabel.style.display = 'block';  // Show "(any time)"
      } else {
        selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
        anyTimeLabel.style.display = 'none';  // Hide "(any time)"
      }

      // Update the visualization based on the time filter
      updateScatterPlot(timeFilter);
    }
    
    // Add event listener to the slider
    timeSlider.addEventListener('input', updateTimeDisplay);
    
    // Initialize the time display
    updateTimeDisplay();
    
  } catch (error) {
    console.error('Error loading data:', error); // Handle errors
  }
});