const STATES = [
  { code: 'AL', name: 'Alabama', geography_shape_id: 50000001, lng: -86.902298, lat: 32.318231 },
  { code: 'AK', name: 'Alaska', geography_shape_id: 50000002, lng: -154.493062, lat: 64.200841 },
  { code: 'AZ', name: 'Arizona', geography_shape_id: 50000004, lng: -111.930736, lat: 34.168033 },
  { code: 'AR', name: 'Arkansas', geography_shape_id: 50000005, lng: -91.831833, lat: 35.201050 },
  { code: 'CA', name: 'California', geography_shape_id: 50000006, lng: -119.306607, lat: 37.269168 },
  { code: 'CO', name: 'Colorado', geography_shape_id: 50000008, lng: -105.782067, lat: 39.550051 },
  { code: 'CT', name: 'Connecticut', geography_shape_id: 50000009, lng: -72.757507, lat: 41.500727 },
  { code: 'DE', name: 'Delaware', geography_shape_id: 50000010, lng: -75.386594, lat: 39.145324 },
  { code: 'FL', name: 'Florida', geography_shape_id: 50000012, lng: -83.804601, lat: 27.698638 },
  { code: 'GA', name: 'Georgia', geography_shape_id: 50000013, lng: -83.194063, lat: 32.678530 },
  { code: 'HI', name: 'Hawaii', geography_shape_id: 50000015, lng: -155.582779, lat: 19.898682 },
  { code: 'ID', name: 'Idaho', geography_shape_id: 50000016, lng: -114.742041, lat: 44.068202 },
  { code: 'IL', name: 'Illinois', geography_shape_id: 50000017, lng: -89.266507, lat: 39.739389 },
  { code: 'IN', name: 'Indiana', geography_shape_id: 50000018, lng: -86.441214, lat: 39.766520 },
  { code: 'IA', name: 'Iowa', geography_shape_id: 50000019, lng: -93.097702, lat: 41.878003 },
  { code: 'KS', name: 'Kansas', geography_shape_id: 50000020, lng: -98.484246, lat: 39.011902 },
  { code: 'KY', name: 'Kentucky', geography_shape_id: 50000021, lng: -84.270018, lat: 37.839333 },
  { code: 'LA', name: 'Louisiana', geography_shape_id: 50000022, lng: -91.400870, lat: 30.937374 },
  { code: 'ME', name: 'Maine', geography_shape_id: 50000023, lng: -69.044701, lat: 45.253783 },
  { code: 'MD', name: 'Maryland', geography_shape_id: 50000024, lng: -77.236967, lat: 38.804821 },
  { code: 'MA', name: 'Massachusetts', geography_shape_id: 50000025, lng: -71.683535, lat: 42.036916 },
  { code: 'MI', name: 'Michigan', geography_shape_id: 50000026, lng: -86.270682, lat: 45.001091 },
  { code: 'MN', name: 'Minnesota', geography_shape_id: 50000027, lng: -93.361239, lat: 46.441920 },
  { code: 'MS', name: 'Mississippi', geography_shape_id: 50000028, lng: -89.398528, lat: 32.354668 },
  { code: 'MO', name: 'Missouri', geography_shape_id: 50000029, lng: -92.436836, lat: 38.304663 },
  { code: 'MT', name: 'Montana', geography_shape_id: 50000030, lng: -110.362566, lat: 46.879682 },
  { code: 'NE', name: 'Nebraska', geography_shape_id: 50000031, lng: -99.680902, lat: 41.500820 },
  { code: 'NV', name: 'Nevada', geography_shape_id: 50000032, lng: -117.022967, lat: 38.501850 },
  { code: 'NH', name: 'New Hampshire', geography_shape_id: 50000033, lng: -71.566109, lat: 44.001410 },
  { code: 'NJ', name: 'New Jersey', geography_shape_id: 50000034, lng: -74.724323, lat: 40.073132 },
  { code: 'NM', name: 'New Mexico', geography_shape_id: 50000035, lng: -105.870090, lat: 34.519940 },
  { code: 'NY', name: 'New York', geography_shape_id: 50000036, lng: -75.770041, lat: 42.746222 },
  { code: 'NC', name: 'North Carolina', geography_shape_id: 50000037, lng: -79.860970, lat: 35.170508 },
  { code: 'ND', name: 'North Dakota', geography_shape_id: 50000038, lng: -101.002012, lat: 47.551493 },
  { code: 'OH', name: 'Ohio', geography_shape_id: 50000039, lng: -82.669505, lat: 40.365278 },
  { code: 'OK', name: 'Oklahoma', geography_shape_id: 50000040, lng: -98.716714, lat: 35.309050 },
  { code: 'OR', name: 'Oregon', geography_shape_id: 50000041, lng: -120.583401, lat: 44.145591 },
  { code: 'PA', name: 'Pennsylvania', geography_shape_id: 50000042, lng: -77.604706, lat: 41.117936 },
  { code: 'RI', name: 'Rhode Island', geography_shape_id: 50000044, lng: -71.477429, lat: 41.580095 },
  { code: 'SC', name: 'South Carolina', geography_shape_id: 50000045, lng: -80.926615, lat: 33.605720 },
  { code: 'SD', name: 'South Dakota', geography_shape_id: 50000046, lng: -99.901813, lat: 43.969515 },
  { code: 'TN', name: 'Tennessee', geography_shape_id: 50000047, lng: -85.978696, lat: 35.830589 },
  { code: 'TX', name: 'Texas', geography_shape_id: 50000048, lng: -100.076843, lat: 31.168934 },
  { code: 'UT', name: 'Utah', geography_shape_id: 50000049, lng: -111.093731, lat: 39.320980 },
  { code: 'VT', name: 'Vermont', geography_shape_id: 50000050, lng: -72.577841, lat: 44.558803 },
  { code: 'VA', name: 'Virginia', geography_shape_id: 50000051, lng: -79.420915, lat: 38.003432 },
  { code: 'WA', name: 'Washington', geography_shape_id: 50000053, lng: -120.740139, lat: 47.400902 },
  { code: 'WV', name: 'West Virginia', geography_shape_id: 50000054, lng: -80.454903, lat: 38.597626 },
  { code: 'WI', name: 'Wisconsin', geography_shape_id: 50000055, lng: -89.616508, lat: 43.784440 },
  { code: 'WY', name: 'Wyoming', geography_shape_id: 50000056, lng: -107.290284, lat: 43.075968 }
];

const projectTypes = [
  'flip',
  'buy_hold',
  'scrape',
]

const locationTypes = [
  'city',
];


const tags = [
  'zombie',
  'preforeclosure',
  'foreclosure',
  'vacant',
  'absentee',
  'cash_buyer,',
  'corporate_owned',
  'tired_landlord',
  'auction',
  'inter_family'
];

const STATE_CODES = STATES.map(state => state.code);

export { STATES, STATE_CODES, projectTypes, locationTypes, tags };

/*
https://app.privy.pro/dashboard?search_text=Texas&location_type=city&geography_shape_id=50000048&project_type=other&lat=31.168934&lng=-100.0768425&zoom=7&sw_lat=25.49579829692516&sw_lng=-109.36139761470258&ne_lat=36.37968133725258&ne_lng=-91.01422964595258&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Florida&location_type=city&geography_shape_id=50000012&project_type=other&lat=27.698638&lng=-83.80460099999999&zoom=7&sw_lat=22.039283894272614&sw_lng=-92.93542957132951&ne_lat=33.27954280537854&ne_lng=-74.58826160257951&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=California&location_type=city&geography_shape_id=50000006&project_type=other&lat=37.269167499999995&lng=-119.30660699999999&zoom=7&sw_lat=32.18825358906081&sw_lng=-128.26620708033442&ne_lat=42.28835879338348&ne_lng=-109.91903911158442&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=New+York&location_type=city&geography_shape_id=50000036&project_type=other&lat=42.7462215&lng=-75.7700405&zoom=8&sw_lat=40.411751567381714&sw_lng=-80.40894585102797&ne_lat=45.079660791424544&ne_lng=-71.23536186665297&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Illinois&location_type=city&geography_shape_id=50000017&project_type=other&lat=39.7393895&lng=-89.26650699999999&zoom=7&sw_lat=34.78825010095876&sw_lng=-98.6450982419774&ne_lat=44.5526458726014&ne_lng=-80.2979302732274&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Ohio&location_type=city&geography_shape_id=50000039&project_type=other&lat=40.3652775&lng=-82.66950499999999&zoom=8&sw_lat=37.745024216871684&sw_lng=-87.29379164933094&ne_lat=42.60196166101227&ne_lng=-78.12020766495594&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Georgia&location_type=city&geography_shape_id=50000013&project_type=other&lat=32.678529999999995&lng=-83.1940625&zoom=8&sw_lat=30.021611892949906&sw_lng=-87.79552379789364&ne_lat=35.371199424044875&ne_lng=-78.62193981351864&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Michigan&location_type=city&geography_shape_id=50000026&project_type=other&lat=45.0010905&lng=-86.2706815&zoom=7&sw_lat=39.71838649708698&sw_lng=-95.63262766985882&ne_lat=48.80198078950693&ne_lng=-77.28545970110882&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=New+Jersey&location_type=city&geography_shape_id=50000034&project_type=other&lat=40.073132&lng=-74.724323&zoom=9&sw_lat=38.911838211266&sw_lng=-77.03730600553432&ne_lat=41.34327540250598&ne_lng=-72.45051401334682&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Virginia&location_type=city&geography_shape_id=50000051&project_type=other&lat=38.003432000000004&lng=-79.420915&zoom=8&sw_lat=35.43627982105427&sw_lng=-84.02242582524195&ne_lat=40.44924459421398&ne_lng=-74.84884184086695&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Arizona&location_type=city&geography_shape_id=50000004&project_type=other&lat=34.168032999999994&lng=-111.930736&zoom=7&sw_lat=28.865030676948706&sw_lng=-121.03852585238309&ne_lat=39.36926098689588&ne_lng=-102.69135788363309&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Massachusetts&location_type=city&geography_shape_id=50000025&project_type=other&lat=42.0369155&lng=-71.68353549999999&zoom=9&sw_lat=40.87035153619041&sw_lng=-74.01154209254311&ne_lat=43.23162091361638&ne_lng=-69.42475010035561&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Minnesota&location_type=city&geography_shape_id=50000027&project_type=other&lat=46.441919999999996&lng=-93.361239&zoom=7&sw_lat=41.93586504975198&sw_lng=-102.65810052515008&ne_lat=50.69547445873454&ne_lng=-84.31093255640008&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Tennessee&location_type=city&geography_shape_id=50000047&project_type=other&lat=35.8305895&lng=-85.9786955&zoom=8&sw_lat=33.201219740993906&sw_lng=-90.51733878767119&ne_lat=38.35822769885624&ne_lng=-81.34375480329619&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Indiana&location_type=city&geography_shape_id=50000018&project_type=other&lat=39.76652&lng=-86.4412135&zoom=8&sw_lat=37.34823951521851&sw_lng=-90.94264545827173&ne_lat=42.232504129443726&ne_lng=-81.76906147389673&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Missouri&location_type=city&geography_shape_id=50000029&project_type=other&lat=38.3046625&lng=-92.436836&zoom=8&sw_lat=35.807502166480106&sw_lng=-97.05709077883512&ne_lat=40.79586878870188&ne_lng=-87.88350679446012&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Maryland&location_type=city&geography_shape_id=50000024&project_type=other&lat=38.804821&lng=-77.2369665&zoom=9&sw_lat=37.596189108124534&sw_lng=-79.55967391895898&ne_lat=40.07325493406705&ne_lng=-74.97288192677148&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=South+Carolina&location_type=city&geography_shape_id=50000045&project_type=other&lat=33.6057195&lng=-80.9266145&zoom=8&sw_lat=30.975165801062715&sw_lng=-85.51549278248689&ne_lat=36.26855264470109&ne_lng=-76.34190879811189&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Louisiana&location_type=city&geography_shape_id=50000022&project_type=other&lat=30.9373735&lng=-91.40087&zoom=8&sw_lat=27.984005573668227&sw_lng=-96.18859126835858&ne_lat=33.94270746607731&ne_lng=-87.01500728398356&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Oregon&location_type=city&geography_shape_id=50000041&project_type=other&lat=44.1455905&lng=-120.58340150000001&zoom=8&sw_lat=41.41049562928799&sw_lng=-125.26313441340768&ne_lat=46.4158004424105&ne_lng=-116.08955042903268&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Oklahoma&location_type=city&geography_shape_id=50000040&project_type=other&lat=35.3090495&lng=-98.7167135&zoom=8&sw_lat=32.51373296386413&sw_lng=-102.56184552563354&ne_lat=38.181452805025856&ne_lng=-93.38826154125854&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Connecticut&location_type=city&geography_shape_id=50000009&project_type=other&lat=41.500727&lng=-72.757507&zoom=10&sw_lat=40.85964664700853&sw_lng=-73.89136750716716&ne_lat=42.16148653342108&ne_lng=-71.59797151107341&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Nevada&location_type=city&geography_shape_id=50000032&project_type=other&lat=38.5018495&lng=-117.022967&zoom=7&sw_lat=32.90170580154506&sw_lng=-126.25812380687907&ne_lat=43.77424804148944&ne_lng=-107.91095583812907&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Nebraska&location_type=city&geography_shape_id=50000031&project_type=other&lat=41.5008195&lng=-99.680902&zoom=8&sw_lat=38.80855992831272&sw_lng=-104.41107703372836&ne_lat=44.0193726026869&ne_lng=-95.23749304935336&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=New+Hampshire&location_type=city&geography_shape_id=50000033&project_type=other&lat=44.00140999999999&lng=-71.566109&zoom=8&sw_lat=41.36646045969002&sw_lng=-76.22044204850681&ne_lat=46.37532030177627&ne_lng=-67.04685806413181&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
https://app.privy.pro/dashboard?search_text=Delaware&location_type=city&geography_shape_id=50000010&project_type=other&lat=39.145324&lng=-75.386594&zoom=9&sw_lat=37.7801344003708&sw_lng=-77.71035372279583&ne_lat=40.47691122183622&ne_lng=-73.12356173060833&size%5Bheight%5D=1158&size%5Bwidth%5D=1670&include_detached=true&include_active=true&date_range=all&source=Any&sort_by=days-on-market&sort_dir=asc
*/